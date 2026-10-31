// Converts between the page as it is shown on screen and PDF coordinates.
//
// On screen a page is drawn by pdf.js at "scale 1": one unit is one point,
// the origin is the top-left corner and the page's own rotation is already
// applied. In the PDF the origin is the bottom-left corner of the page's box,
// y goes up and the rotation is applied later by the viewer.

/** The visible area of a page in PDF coordinates (its crop box). */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A rectangle on the page as shown, in points from the top-left corner. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Rotation = 0 | 90 | 180 | 270;

export interface Point {
  x: number;
  y: number;
}

/** Turns a page's /Rotate value into 0, 90, 180 or 270, like pdf.js does. */
export const normaliseRotation = (angle: number): Rotation => {
  if (!Number.isFinite(angle) || angle % 90 !== 0) {
    return 0;
  }
  return (((angle % 360) + 360) % 360) as Rotation;
};

/**
 * The part of the media box that the crop box keeps, as pdf.js shows it.
 * Boxes are given as pdf-lib returns them: x, y, width and height.
 */
export const visibleBox = (
  media: { x: number; y: number; width: number; height: number },
  crop?: { x: number; y: number; width: number; height: number },
): Box => {
  const toBox = (b: { x: number; y: number; width: number; height: number }) => ({
    x0: Math.min(b.x, b.x + b.width),
    y0: Math.min(b.y, b.y + b.height),
    x1: Math.max(b.x, b.x + b.width),
    y1: Math.max(b.y, b.y + b.height),
  });
  const m = toBox(media);
  if (!crop) {
    return m;
  }
  const c = toBox(crop);
  const box = {
    x0: Math.max(m.x0, c.x0),
    y0: Math.max(m.y0, c.y0),
    x1: Math.min(m.x1, c.x1),
    y1: Math.min(m.y1, c.y1),
  };
  return box.x1 > box.x0 && box.y1 > box.y0 ? box : m;
};

/** Width and height of a page as shown, in points. */
export const viewSize = (box: Box, rotation: Rotation) => {
  const width = box.x1 - box.x0;
  const height = box.y1 - box.y0;
  return rotation % 180 === 0 ? { width, height } : { width: height, height: width };
};

/** Converts a point on the page as shown to PDF coordinates. */
export const viewToPdf = (x: number, y: number, box: Box, rotation: Rotation): Point => {
  switch (rotation) {
    case 90:
      return { x: box.x0 + y, y: box.y0 + x };
    case 180:
      return { x: box.x1 - x, y: box.y0 + y };
    case 270:
      return { x: box.x1 - y, y: box.y1 - x };
    default:
      return { x: box.x0 + x, y: box.y1 - y };
  }
};

/** Converts a point in PDF coordinates to the page as shown. */
export const pdfToView = (x: number, y: number, box: Box, rotation: Rotation): Point => {
  switch (rotation) {
    case 90:
      return { x: y - box.y0, y: x - box.x0 };
    case 180:
      return { x: box.x1 - x, y: y - box.y0 };
    case 270:
      return { x: box.y1 - y, y: box.x1 - x };
    default:
      return { x: x - box.x0, y: box.y1 - y };
  }
};

/**
 * Where to draw something that fills `rect` and reads upright on screen: the
 * PDF point of its bottom-left corner, and the counter-clockwise turn to give
 * it (pdf-lib's `rotate`), which undoes the page's clockwise rotation.
 */
export const rectAnchor = (rect: Rect, box: Box, rotation: Rotation) => ({
  ...viewToPdf(rect.x, rect.y + rect.height, box, rotation),
  rotate: rotation,
});

/** The same area as `rect`, as an upright rectangle in PDF coordinates. */
export const rectToPdf = (rect: Rect, box: Box, rotation: Rotation) => {
  const a = viewToPdf(rect.x, rect.y, box, rotation);
  const b = viewToPdf(rect.x + rect.width, rect.y + rect.height, box, rotation);
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
};

/** Line height of placed text, as a multiple of the font size. */
export const LINE_HEIGHT = 1.25;
// Helvetica (and Liberation Sans, used on screen) ascent and descent
const ASCENT = 0.905;
const DESCENT = 0.212;

/**
 * Distance from the top of a line of text to its baseline, matching how the
 * browser lays out one line with `line-height: LINE_HEIGHT`.
 */
export const textBaseline = (size: number) =>
  size * ((LINE_HEIGHT - ASCENT - DESCENT) / 2 + ASCENT);

/** Keeps a rectangle on the page, moving it (not resizing) where possible. */
export const clampRect = (rect: Rect, width: number, height: number): Rect => {
  const w = Math.min(rect.width, width);
  const h = Math.min(rect.height, height);
  return {
    x: Math.min(Math.max(rect.x, 0), width - w),
    y: Math.min(Math.max(rect.y, 0), height - h),
    width: w,
    height: h,
  };
};

/** A rectangle of the given size centred on a point, kept on the page. */
export const centredRect = (
  point: Point,
  size: { width: number; height: number },
  page: { width: number; height: number },
): Rect =>
  clampRect(
    {
      x: point.x - size.width / 2,
      y: point.y - size.height / 2,
      ...size,
    },
    page.width,
    page.height,
  );

/** Fits a width and height inside a maximum size, keeping the proportions. */
export const fitInside = (
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
) => {
  const scale = Math.min(maxWidth / width, maxHeight / height);
  return { width: width * scale, height: height * scale };
};

/**
 * Zoom that makes a typical page fit the viewer, within sensible limits. The
 * median width is used so one sideways page does not shrink all the others.
 */
export const fitZoom = (viewerWidth: number, pageWidths: number[], gutter = 32) => {
  const sorted = [...pageWidths].sort((a, b) => a - b);
  const typical = Math.max(1, sorted[Math.floor((sorted.length - 1) / 2)] ?? 1);
  return clampZoom((viewerWidth - gutter) / typical);
};

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;

export const clampZoom = (zoom: number) =>
  Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number.isFinite(zoom) ? zoom : 1));
