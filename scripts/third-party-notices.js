// Writes THIRD_PARTY_NOTICES.md (and a copy in dist/ that the app links to)
// from the licences collected during the build (see vite.config.ts), plus
// files that are copied rather than bundled: fonts, the pdf.js worker and the
// pdf.js run-time files.
import fs from "node:fs";
import path from "node:path";

const read = (file) => fs.readFileSync(file, "utf8").replace(/\r\n?/g, "\n").trim();
const packageJson = (name) =>
  JSON.parse(fs.readFileSync(path.join("node_modules", name, "package.json"), "utf8"));
const licenceFile = (dir) => {
  const file = fs.readdirSync(dir).find((name) => /^licen[cs]e/i.test(name));
  return file ? read(path.join(dir, file)) : undefined;
};

const collected = JSON.parse(
  fs.readFileSync("node_modules/.cache/third-party-licences.json", "utf8"),
);

// Packages used through file URLs, which the bundler does not list
for (const name of ["pdfjs-dist"]) {
  if (!collected.some((entry) => entry.name === name)) {
    const meta = packageJson(name);
    collected.push({
      name,
      version: meta.version,
      license: meta.license,
      licenseText: licenceFile(path.join("node_modules", name)),
      repository:
        typeof meta.repository === "string" ? meta.repository : meta.repository?.url,
    });
  }
}

const fonts = [
  ["@fontsource-variable/inter", "Inter font"],
  ["@fontsource-variable/plus-jakarta-sans", "Plus Jakarta Sans font"],
  ["@fontsource/caveat", "Caveat font"],
  ["@fontsource/dancing-script", "Dancing Script font"],
].map(([name, title]) => {
  const meta = packageJson(name);
  return {
    name: title,
    version: meta.version,
    license: meta.license,
    licenseText: licenceFile(path.join("node_modules", name)),
  };
});

// Files pdf.js loads at run time, each with its own licence
const assets = "node_modules/pdfjs-dist";
const runtime = [
  ["Adobe character maps (pdf.js cmaps)", "cmaps/LICENSE"],
  ["Colour profile (pdf.js iccs)", "iccs/LICENSE"],
  ["Foxit fonts (pdf.js standard fonts)", "standard_fonts/LICENSE_FOXIT"],
  [
    "Liberation Sans fonts (pdf.js standard fonts, GPL-2.0 with font exception)",
    "standard_fonts/LICENSE_LIBERATION",
  ],
  ["OpenJPEG decoder (pdf.js wasm)", "wasm/LICENSE_OPENJPEG"],
  ["pdf.js OpenJPEG build (pdf.js wasm)", "wasm/LICENSE_PDFJS_OPENJPEG"],
  ["JBIG2 decoder (pdf.js wasm)", "wasm/LICENSE_JBIG2"],
  ["pdf.js JBIG2 build (pdf.js wasm)", "wasm/LICENSE_PDFJS_JBIG2"],
  ["qcms colour management (pdf.js wasm)", "wasm/LICENSE_QCMS"],
  ["pdf.js qcms build (pdf.js wasm)", "wasm/LICENSE_PDFJS_QCMS"],
].map(([name, file]) => ({
  name,
  version: packageJson("pdfjs-dist").version,
  license: undefined,
  licenseText: read(path.join(assets, file)),
}));

const seen = new Set();
const entries = [...collected, ...fonts, ...runtime]
  .filter(({ name, version }) => {
    const key = `${name}@${version}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  })
  .sort((a, b) => a.name.localeCompare(b.name));

const missing = entries.filter((entry) => !entry.licenseText);
if (missing.length) {
  throw new Error(`No licence text for: ${missing.map((e) => e.name).join(", ")}`);
}

const sections = entries.map(
  ({ name, version, license, licenseText, noticeText, repository }) =>
    [
      `## ${name} ${version}`,
      "",
      `- Licence: ${license ?? "see text below"}`,
      ...(repository ? [`- Source: ${repository}`] : []),
      "",
      "```text",
      licenseText.replace(/\r\n?/g, "\n").trim(),
      ...(noticeText ? ["", noticeText.replace(/\r\n?/g, "\n").trim()] : []),
      "```",
      "",
    ].join("\n"),
);

const text = [
  "# Third-party notices",
  "",
  "Solvey Fill & Sign includes the following third-party software, fonts and",
  "data files. Each is listed with its full licence text.",
  "",
  ...sections,
].join("\n");

fs.writeFileSync("THIRD_PARTY_NOTICES.md", text);
if (fs.existsSync("dist")) {
  fs.writeFileSync(path.join("dist", "THIRD_PARTY_NOTICES.txt"), text);
}
console.log(`Wrote ${entries.length} notices to THIRD_PARTY_NOTICES.md`);
