// Copies the files pdf.js loads at run time (character maps, standard fonts,
// colour profiles and WebAssembly decoders) into public/pdfjs, so the app
// serves them itself. Each folder keeps its licence files.
import fs from "node:fs";
import path from "node:path";

const source = path.join("node_modules", "pdfjs-dist");
const target = path.join("public", "pdfjs");
const folders = ["cmaps", "iccs", "standard_fonts", "wasm"];
// the JavaScript sandbox is only needed for PDF scripting, which is disabled
const skip = /^quickjs-eval\./;

fs.rmSync(target, { recursive: true, force: true });
for (const folder of folders) {
  const from = path.join(source, folder);
  const to = path.join(target, folder);
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    if (!skip.test(name)) {
      fs.copyFileSync(path.join(from, name), path.join(to, name));
    }
  }
}
console.log(`Copied pdf.js assets to ${target}`);
