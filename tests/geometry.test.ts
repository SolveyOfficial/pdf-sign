import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { degrees, PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import {
  centredRect,
  clampRect,
  clampZoom,
  fitInside,
  fitZoom,
  normaliseRotation,
  pdfToView,
  rectAnchor,
  rectToPdf,
  textBaseline,
  viewSize,
  viewToPdf,
  visibleBox,
  type Box,
  type Rotation,
} from "../src/lib/geometry";

const box: Box = { x0: 10, y0: 20, x1: 210, y1: 320 }; // 200 x 300
const rotations: Rotation[] = [0, 90, 180, 270];

describe("normaliseRotation", () => {
  it("keeps multiples of 90 between 0 and 270", () => {
    expect(normaliseRotation(0)).toBe(0);
    expect(normaliseRotation(450)).toBe(90);
    expect(normaliseRotation(-90)).toBe(270);
    expect(normaliseRotation(-180)).toBe(180);
    expect(normaliseRotation(720)).toBe(0);
  });

  it("ignores angles pdf.js ignores", () => {
    expect(normaliseRotation(45)).toBe(0);
    expect(normaliseRotation(Number.NaN)).toBe(0);
  });
});

describe("visibleBox", () => {
  it("uses the media box when there is no crop box", () => {
    expect(visibleBox({ x: 0, y: 0, width: 100, height: 50 })).toEqual({
      x0: 0,
      y0: 0,
      x1: 100,
      y1: 50,
    });
  });

  it("keeps only the part of the crop box inside the media box", () => {
    expect(
      visibleBox(
        { x: 0, y: 0, width: 100, height: 100 },
        { x: 20, y: -10, width: 200, height: 50 },
      ),
    ).toEqual({ x0: 20, y0: 0, x1: 100, y1: 40 });
  });

  it("accepts boxes given with negative sizes", () => {
    expect(visibleBox({ x: 100, y: 100, width: -100, height: -50 })).toEqual({
      x0: 0,
      y0: 50,
      x1: 100,
      y1: 100,
    });
  });

  it("falls back to the media box when the crop box is outside it", () => {
    expect(
      visibleBox(
        { x: 0, y: 0, width: 100, height: 100 },
        { x: 200, y: 200, width: 10, height: 10 },
      ),
    ).toEqual({ x0: 0, y0: 0, x1: 100, y1: 100 });
  });
});

describe("viewSize", () => {
  it("swaps width and height for sideways pages", () => {
    expect(viewSize(box, 0)).toEqual({ width: 200, height: 300 });
    expect(viewSize(box, 90)).toEqual({ width: 300, height: 200 });
    expect(viewSize(box, 180)).toEqual({ width: 200, height: 300 });
    expect(viewSize(box, 270)).toEqual({ width: 300, height: 200 });
  });
});

describe("viewToPdf", () => {
  it("maps the top-left corner on screen for each rotation", () => {
    expect(viewToPdf(0, 0, box, 0)).toEqual({ x: 10, y: 320 });
    // turned clockwise, the PDF's bottom-left corner is at the top left
    expect(viewToPdf(0, 0, box, 90)).toEqual({ x: 10, y: 20 });
    expect(viewToPdf(0, 0, box, 180)).toEqual({ x: 210, y: 20 });
    expect(viewToPdf(0, 0, box, 270)).toEqual({ x: 210, y: 320 });
  });

  it("is undone by pdfToView", () => {
    for (const rotation of rotations) {
      for (const [x, y] of [
        [0, 0],
        [12.5, 40],
        [150, 99],
      ]) {
        const pdf = viewToPdf(x, y, box, rotation);
        expect(pdfToView(pdf.x, pdf.y, box, rotation)).toEqual({ x, y });
      }
    }
  });

  it("matches pdf.js for every rotation and an offset crop box", async () => {
    for (const rotation of rotations) {
      const doc = await PDFDocument.create();
      const page = doc.addPage([400, 500]);
      page.setMediaBox(-30, 15, 400, 500);
      page.setCropBox(10, 20, 200, 300);
      page.setRotation(degrees(rotation));
      const bytes = await doc.save();
      const task = getDocument({ data: bytes, verbosity: 0 });
      const pdf = await task.promise;
      const viewport = (await pdf.getPage(1)).getViewport({ scale: 1 });
      expect(viewSize(box, rotation)).toEqual({
        width: viewport.width,
        height: viewport.height,
      });
      for (const [x, y] of [
        [0, 0],
        [33, 71],
        [viewport.width, viewport.height],
      ]) {
        const [px, py] = viewport.convertToPdfPoint(x, y);
        const ours = viewToPdf(x, y, box, rotation);
        expect(ours.x).toBeCloseTo(px, 6);
        expect(ours.y).toBeCloseTo(py, 6);
      }
      await task.destroy();
    }
  });
});

describe("rectAnchor", () => {
  it("gives the bottom-left corner of the rectangle as shown", () => {
    const rect = { x: 30, y: 40, width: 50, height: 20 };
    expect(rectAnchor(rect, box, 0)).toEqual({ x: 40, y: 260, rotate: 0 });
    expect(rectAnchor(rect, box, 90)).toEqual({ x: 70, y: 50, rotate: 90 });
    expect(rectAnchor(rect, box, 180)).toEqual({ x: 180, y: 80, rotate: 180 });
    expect(rectAnchor(rect, box, 270)).toEqual({ x: 150, y: 290, rotate: 270 });
  });
});

describe("rectToPdf", () => {
  it("covers the same area for every rotation", () => {
    const rect = { x: 30, y: 40, width: 50, height: 20 };
    expect(rectToPdf(rect, box, 0)).toEqual({ x: 40, y: 260, width: 50, height: 20 });
    expect(rectToPdf(rect, box, 90)).toEqual({ x: 50, y: 50, width: 20, height: 50 });
    expect(rectToPdf(rect, box, 180)).toEqual({ x: 130, y: 60, width: 50, height: 20 });
    expect(rectToPdf(rect, box, 270)).toEqual({ x: 150, y: 240, width: 20, height: 50 });
  });
});

describe("textBaseline", () => {
  it("puts the baseline a little below the font size", () => {
    expect(textBaseline(10)).toBeCloseTo(9.715, 6);
    expect(textBaseline(20)).toBeCloseTo(2 * textBaseline(10), 6);
  });
});

describe("clampRect and centredRect", () => {
  it("moves a rectangle back onto the page", () => {
    expect(clampRect({ x: -5, y: 290, width: 20, height: 20 }, 200, 300)).toEqual({
      x: 0,
      y: 280,
      width: 20,
      height: 20,
    });
  });

  it("shrinks a rectangle larger than the page", () => {
    expect(clampRect({ x: 10, y: 10, width: 500, height: 20 }, 200, 300)).toEqual({
      x: 0,
      y: 10,
      width: 200,
      height: 20,
    });
  });

  it("centres a rectangle on a point", () => {
    expect(
      centredRect(
        { x: 100, y: 100 },
        { width: 40, height: 20 },
        { width: 200, height: 300 },
      ),
    ).toEqual({ x: 80, y: 90, width: 40, height: 20 });
    expect(
      centredRect({ x: 5, y: 5 }, { width: 40, height: 20 }, { width: 200, height: 300 }),
    ).toEqual({ x: 0, y: 0, width: 40, height: 20 });
  });
});

describe("fitInside", () => {
  it("keeps the proportions", () => {
    expect(fitInside(400, 100, 160, 56)).toEqual({ width: 160, height: 40 });
    const square = fitInside(100, 100, 160, 56);
    expect(square.width).toBeCloseTo(56, 9);
    expect(square.height).toBeCloseTo(56, 9);
  });
});

describe("zoom", () => {
  it("fits a typical page", () => {
    expect(fitZoom(632, [600, 600])).toBe(1);
    expect(fitZoom(332, [600])).toBe(0.5);
    // one sideways page among upright ones
    expect(fitZoom(627, [595, 842, 595])).toBe(1);
    expect(fitZoom(332, [300, 600])).toBeCloseTo(1, 6);
  });

  it("stays within limits", () => {
    expect(clampZoom(10)).toBe(4);
    expect(clampZoom(0.01)).toBe(0.25);
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(fitZoom(10_000, [100])).toBe(4);
  });
});
