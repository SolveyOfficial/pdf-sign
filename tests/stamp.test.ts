import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  degrees,
  PDFArray,
  PDFDocument,
  PDFRawStream,
  StandardFonts,
  decodePDFRawStream,
} from "pdf-lib";
import { describe, expect, it } from "vitest";

import { fillFields, readFields } from "../src/lib/forms";
import { dataUrlBytes } from "../src/lib/image";
import type { Item } from "../src/lib/items";
import { drawOrder } from "../src/lib/items";
import { loadPdf, stampPdf } from "../src/lib/stamp";

const PNG = dataUrlBytes(
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
);

/** A two-page PDF: an upright A4 page with a form, and a sideways page. */
const samplePdf = async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const first = doc.addPage([595, 842]);
  first.drawText("Original agreement text", { x: 50, y: 780, size: 14, font });
  const second = doc.addPage([400, 600]);
  second.setRotation(degrees(90));
  second.drawText("Second page", { x: 50, y: 500, size: 12, font });
  const form = doc.getForm();
  form
    .createTextField("name")
    .addToPage(first, { x: 50, y: 700, width: 200, height: 20 });
  form.createCheckBox("agree").addToPage(first, { x: 50, y: 660, width: 14, height: 14 });
  const dropdown = form.createDropdown("city");
  dropdown.addOptions(["Delhi", "Mumbai", "Pune"]);
  dropdown.addToPage(first, { x: 50, y: 620, width: 120, height: 20 });
  const radio = form.createRadioGroup("plan");
  radio.addOptionToPage("basic", first, { x: 50, y: 580, width: 12, height: 12 });
  radio.addOptionToPage("pro", first, { x: 80, y: 580, width: 12, height: 12 });
  return doc.save();
};

const textItems = async (bytes: Uint8Array) => {
  const task = getDocument({ data: bytes.slice(), verbosity: 0 });
  const pdf = await task.promise;
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    pages.push(
      content.items
        .filter((item) => "str" in item)
        .map((item) => {
          const [, , , , x, y] = (item as { transform: number[] }).transform;
          const [vx, vy] = viewport.convertToViewportPoint(x, y);
          return { str: (item as { str: string }).str, x: vx, y: vy };
        }),
    );
  }
  await task.destroy();
  return pages;
};

const contentText = (doc: PDFDocument, index: number) => {
  const contents = doc.getPages()[index].node.Contents()!;
  const parts = contents instanceof PDFArray ? contents.asArray() : [contents];
  return parts
    .map((part) => {
      const stream = doc.context.lookup(part);
      return stream instanceof PDFRawStream
        ? new TextDecoder().decode(decodePDFRawStream(stream).decode())
        : "";
    })
    .join("\n");
};

const items: Item[] = [
  {
    id: "sig",
    kind: "image",
    page: 0,
    image: "png",
    rect: { x: 300, y: 700, width: 120, height: 40 },
  },
  {
    id: "text",
    kind: "text",
    page: 0,
    text: "Signed by Asha",
    size: 14,
    color: "#1a3fa0",
    rect: { x: 100, y: 200, width: 100, height: 17.5 },
  },
  {
    id: "date",
    kind: "date",
    page: 1,
    text: "31/10/2026",
    size: 12,
    color: "#000000",
    rect: { x: 60, y: 80, width: 60, height: 15 },
  },
  {
    id: "tick",
    kind: "tick",
    page: 1,
    color: "#000000",
    rect: { x: 200, y: 200, width: 14, height: 14 },
  },
  { id: "out", kind: "whiteout", page: 0, rect: { x: 10, y: 10, width: 40, height: 10 } },
];

describe("stampPdf", () => {
  it("adds items and keeps the pages and the original text", async () => {
    const input = await samplePdf();
    const output = await stampPdf(input, { items, images: new Map([["png", PNG]]) });
    const doc = await PDFDocument.load(output);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPages()[1].getRotation().angle).toBe(90);

    const first = contentText(doc, 0);
    expect(first).toMatch(/\/Image-?\d* Do|Do/);
    expect(first).toContain("1 1 1 rg"); // white-out
    const second = contentText(doc, 1);
    expect(second).toMatch(/ l\b/); // tick lines

    const pages = await textItems(output);
    expect(pages[0].map((t) => t.str)).toContain("Original agreement text");
    const signed = pages[0].find((t) => t.str === "Signed by Asha")!;
    // the baseline sits textBaseline(14) below the top of the box
    expect(signed.x).toBeCloseTo(100, 3);
    expect(signed.y).toBeCloseTo(200 + 13.601, 2);
    // on the sideways page the date still lands where it was placed
    const date = pages[1].find((t) => t.str === "31/10/2026")!;
    expect(date.x).toBeCloseTo(60, 3);
    expect(date.y).toBeCloseTo(80 + 11.658, 2);
  });

  it("fills in form fields and can flatten them", async () => {
    const input = await samplePdf();
    const fields = { name: "Asha Rao", agree: true, city: "Pune", plan: "pro" };
    const filled = await PDFDocument.load(
      await stampPdf(input, { items: [], images: new Map(), fields }),
    );
    const values = Object.fromEntries(readFields(filled).map((f) => [f.name, f.value]));
    expect(values).toEqual(fields);

    const flat = await PDFDocument.load(
      await stampPdf(input, { items: [], images: new Map(), fields, flatten: true }),
    );
    expect(flat.getForm().getFields()).toHaveLength(0);
    expect((await textItems(await flat.save()))[0].map((t) => t.str)).toContain(
      "Asha Rao",
    );
  });

  it("explains characters a form field cannot hold", async () => {
    const input = await samplePdf();
    await expect(
      stampPdf(input, { items: [], images: new Map(), fields: { name: "नमस्ते" } }),
    ).rejects.toThrow(/Latin letters/);
  });

  it("refuses a missing picture", async () => {
    const input = await samplePdf();
    await expect(
      stampPdf(input, { items: [items[0]], images: new Map() }),
    ).rejects.toThrow();
  });
});

describe("readFields", () => {
  it("lists text, checkbox, choice and radio fields", async () => {
    const doc = await loadPdf(await samplePdf());
    expect(readFields(doc)).toEqual([
      expect.objectContaining({ name: "name", kind: "text", value: "" }),
      expect.objectContaining({ name: "agree", kind: "checkbox", value: false }),
      expect.objectContaining({
        name: "city",
        kind: "choice",
        options: ["Delhi", "Mumbai", "Pune"],
      }),
      expect.objectContaining({ name: "plan", kind: "radio", options: ["basic", "pro"] }),
    ]);
  });

  it("returns nothing for a PDF without a form", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    expect(readFields(doc)).toEqual([]);
  });

  it("clears values set to empty", async () => {
    const doc = await loadPdf(await samplePdf());
    fillFields(doc, { name: "x", city: "Delhi" });
    fillFields(doc, { name: "", city: "", agree: false, plan: "" });
    const values = Object.fromEntries(readFields(doc).map((f) => [f.name, f.value]));
    expect(values).toEqual({ name: "", agree: false, city: "", plan: "" });
  });
});

describe("drawOrder", () => {
  it("draws white-outs first", () => {
    expect(drawOrder(items).map((item) => item.id)).toEqual([
      "out",
      "sig",
      "text",
      "date",
      "tick",
    ]);
  });
});

describe("loadPdf", () => {
  it("rejects files that are not PDFs", async () => {
    await expect(loadPdf(new TextEncoder().encode("hello"))).rejects.toThrow();
  });
});
