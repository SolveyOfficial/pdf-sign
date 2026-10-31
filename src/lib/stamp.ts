// Writes placed items and form values into a PDF with pdf-lib. The original
// page content is kept as it is, so its text stays selectable.
import { degrees, LineCapStyle, PDFDocument, rgb, StandardFonts } from "pdf-lib";

import { UserError } from "./errors";
import { fillFields, type FieldValue } from "./forms";
import {
  normaliseRotation,
  rectAnchor,
  rectToPdf,
  textBaseline,
  viewToPdf,
  visibleBox,
} from "./geometry";
import { drawOrder, MARK_LINES, MARK_STROKE, type Item } from "./items";
import { fitsStandardFont, hexToRgb } from "./text";

export interface StampOptions {
  items: Item[];
  /** PNG pictures used by "image" items, by id. */
  images: Map<string, Uint8Array>;
  /** Form values to fill in, by field name. */
  fields?: Record<string, FieldValue>;
  /** Turn form fields into plain page content. */
  flatten?: boolean;
}

/** Loads a PDF, also accepting files that are only protected from editing. */
export const loadPdf = async (bytes: Uint8Array) => {
  const doc = await PDFDocument.load(bytes, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  if (doc.isEncrypted) {
    throw new UserError(
      "This PDF is protected with a password or locked against changes, so it can't be signed here.",
    );
  }
  return doc;
};

const colour = (hex = "#000000") => {
  const { r, g, b } = hexToRgb(hex);
  return rgb(r, g, b);
};

const fontError = (error: unknown) =>
  error instanceof Error && /WinAnsi cannot encode/i.test(error.message)
    ? new UserError(
        "Form fields can only hold Latin letters, numbers and common symbols. Remove other characters and try again.",
      )
    : error;

export const stampPdf = async (bytes: Uint8Array, options: StampOptions) => {
  const doc = await loadPdf(bytes);
  try {
    if (options.fields) {
      fillFields(doc, options.fields);
    }
    if (options.flatten) {
      doc.getForm().flatten();
    }
  } catch (error) {
    throw fontError(error);
  }

  const pages = doc.getPages();
  const font = options.items.some((item) => item.text)
    ? await doc.embedFont(StandardFonts.Helvetica)
    : undefined;
  const embedded = new Map<string, Awaited<ReturnType<PDFDocument["embedPng"]>>>();

  for (const item of drawOrder(options.items)) {
    const page = pages[item.page];
    if (!page) {
      continue;
    }
    const box = visibleBox(page.getMediaBox(), page.getCropBox());
    const rotation = normaliseRotation(page.getRotation().angle);
    const rect = item.rect;

    switch (item.kind) {
      case "whiteout": {
        page.drawRectangle({ ...rectToPdf(rect, box, rotation), color: rgb(1, 1, 1) });
        break;
      }
      case "image": {
        const png = item.image && options.images.get(item.image);
        if (!png) {
          throw new Error(`Missing picture for ${item.id}`);
        }
        let image = embedded.get(item.image!);
        if (!image) {
          image = await doc.embedPng(png);
          embedded.set(item.image!, image);
        }
        const anchor = rectAnchor(rect, box, rotation);
        page.drawImage(image, {
          x: anchor.x,
          y: anchor.y,
          width: rect.width,
          height: rect.height,
          rotate: degrees(anchor.rotate),
        });
        break;
      }
      case "text":
      case "date": {
        const text = (item.text ?? "").replace(/[\r\n\t]+/g, " ");
        if (!text.trim()) {
          break;
        }
        if (!fitsStandardFont(text)) {
          // the editor turns such text into pictures before saving
          throw new UserError(`"${text}" can't be written with the standard PDF font.`);
        }
        const size = item.size ?? 12;
        const origin = viewToPdf(rect.x, rect.y + textBaseline(size), box, rotation);
        page.drawText(text, {
          x: origin.x,
          y: origin.y,
          size,
          font,
          color: colour(item.color),
          rotate: degrees(rotation),
        });
        break;
      }
      case "tick":
      case "cross": {
        const thickness = Math.min(rect.width, rect.height) * MARK_STROKE;
        for (const line of MARK_LINES[item.kind]) {
          const points = line.map(([u, v]) =>
            viewToPdf(rect.x + u * rect.width, rect.y + v * rect.height, box, rotation),
          );
          for (let i = 1; i < points.length; i++) {
            page.drawLine({
              start: points[i - 1],
              end: points[i],
              thickness,
              color: colour(item.color),
              lineCap: LineCapStyle.Round,
            });
          }
        }
        break;
      }
    }
  }

  try {
    return await doc.save({ useObjectStreams: true });
  } catch (error) {
    throw fontError(error);
  }
};
