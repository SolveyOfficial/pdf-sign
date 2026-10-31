// Draws PDF pages into canvases with pdf.js. Everything pdf.js needs is
// served by the app itself (see scripts/copy-pdfjs-assets.js).
import {
  AnnotationMode,
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;

const assets = `${import.meta.env.BASE_URL}pdfjs/`;

const tasks = new WeakMap<PDFDocumentProxy, { destroy(): Promise<void> }>();

export const openPdf = async (bytes: Uint8Array): Promise<PDFDocumentProxy> => {
  const task = getDocument({
    // pdf.js takes ownership of the buffer, so give it a copy
    data: bytes.slice(),
    cMapUrl: `${assets}cmaps/`,
    cMapPacked: true,
    iccUrl: `${assets}iccs/`,
    standardFontDataUrl: `${assets}standard_fonts/`,
    wasmUrl: `${assets}wasm/`,
    enableXfa: false,
  });
  const doc = await task.promise;
  tasks.set(doc, task);
  return doc;
};

/** Frees the memory and worker used by a document opened with `openPdf`. */
export const closePdf = async (doc: PDFDocumentProxy) => {
  await tasks.get(doc)?.destroy();
  tasks.delete(doc);
};

/** Size of a page in points, after its own rotation. */
export const pageSize = (page: PDFPageProxy) => {
  const viewport = page.getViewport({ scale: 1 });
  return { width: viewport.width, height: viewport.height };
};

/**
 * Renders a page onto a new canvas. `scale` is pixels per point (1 = 72 DPI);
 * `rotation` is added to the page's own rotation. The background is white so
 * transparent pages do not turn black when saved as JPEG. Form fields are
 * painted with their values (with ENABLE_STORAGE, the values set in the
 * document's annotation storage).
 */
export const renderPage = async (
  page: PDFPageProxy,
  scale: number,
  rotation = 0,
  annotationMode: number = AnnotationMode.ENABLE,
): Promise<HTMLCanvasElement> => {
  const viewport = page.getViewport({
    scale,
    rotation: (page.rotate + rotation + 360) % 360,
  });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  await page.render({
    canvas,
    viewport,
    background: "#fff",
    annotationMode,
  }).promise;
  return canvas;
};

/** Largest scale that keeps a canvas within browser limits. */
export const safeScale = (
  width: number,
  height: number,
  scale: number,
  maxPixels = 16_000_000,
) => Math.min(scale, Math.sqrt(maxPixels / (width * height)));

export const canvasToBlob = (
  canvas: HTMLCanvasElement,
  type: "image/jpeg" | "image/png",
  quality?: number,
) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not create the image."))),
      type,
      quality,
    ),
  );

export const blobBytes = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());
