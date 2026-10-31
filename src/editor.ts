// The editor: shows the pages of a PDF, lets the user place signatures,
// text, dates, marks and white-outs on them, fill in form fields, and save.
import { AnnotationMode, type PDFDocumentProxy } from "pdfjs-dist";
import { PDFDocument, StandardFonts, type PDFFont } from "pdf-lib";

import { UserError } from "./lib/errors";
import { readFields, type FieldValue, type FormField } from "./lib/forms";
import {
  centredRect,
  clampRect,
  clampZoom,
  fitInside,
  fitZoom,
  LINE_HEIGHT,
  textBaseline,
  type Rect,
} from "./lib/geometry";
import { bytesDataUrl } from "./lib/image";
import {
  ITEM_NAMES,
  MARK_LINES,
  MARK_STROKE,
  type Item,
  type ItemKind,
} from "./lib/items";
import {
  blobBytes,
  canvasToBlob,
  closePdf,
  openPdf,
  renderPage,
  safeScale,
} from "./lib/render";
import { loadPdf, stampPdf } from "./lib/stamp";
import {
  fitsStandardFont,
  formatDate,
  isPdf,
  outputName,
  type InputFile,
} from "./lib/text";
import { newId, signatureDialog, type Picture } from "./signature";
import { capture, dropZone, field, h, iconButton, runTask, statusArea } from "./ui";

const SVG = "http://www.w3.org/2000/svg";
const TEXT_FONT = `"PDF Sans", Helvetica, Arial, sans-serif`;

const svgIcon = (paths: string) => {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "tool__icon");
  svg.innerHTML = paths;
  return svg;
};

const ICONS: Record<ItemKind, string> = {
  image:
    '<path d="M3 17c3-1 4-9 6-9s-1 9 1 9 3-5 4-5 0 4 2 4 3-2 5-3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 21h18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  text: '<path d="M5 6V4h14v2M12 4v16M9 20h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  date: '<rect x="3.5" y="5" width="17" height="15" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M3.5 10h17M8 3v4M16 3v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  tick: '<path d="M4 12.5l5 5L20 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  cross:
    '<path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  whiteout:
    '<rect x="3" y="7" width="18" height="10" rx="1.5" fill="#fff" stroke="currentColor" stroke-width="1.4"/>',
};

const markSvg = (kind: "tick" | "cross") => {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("aria-hidden", "true");
  for (const line of MARK_LINES[kind]) {
    const path = document.createElementNS(SVG, "polyline");
    path.setAttribute("points", line.map(([u, v]) => `${u * 100},${v * 100}`).join(" "));
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", String(MARK_STROKE * 100));
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.append(path);
  }
  return svg;
};

interface PageView {
  index: number;
  /** Size as shown at zoom 1, in points. */
  width: number;
  height: number;
  element: HTMLElement;
  layer: HTMLElement;
  canvas: HTMLCanvasElement | null;
  renderedZoom: number;
  visible: boolean;
}

interface Session {
  file: InputFile;
  pdf: PDFDocumentProxy;
  pages: PageView[];
  fields: FormField[];
  /** pdf.js annotation ids for each field name, for the live preview. */
  fieldIds: Map<string, { id: string; exportValue?: string }[]>;
}

const HINTS: Record<ItemKind, string> = {
  image: "Tap on a page where you want your signature.",
  text: "Tap on a page where the text should start.",
  date: "Tap on a page where you want the date.",
  tick: "Tap on a page to add ticks. Choose Done when you have finished.",
  cross: "Tap on a page to add crosses. Choose Done when you have finished.",
  whiteout: "Tap on a page over the text you want to cover.",
};

export const mountEditor = (container: HTMLElement) => {
  let session: Session | null = null;
  let items: Item[] = [];
  let selected: string | null = null;
  let armed: { kind: ItemKind; image?: string } | null = null;
  let zoom = 1;
  const history: Item[][] = [];
  const pictures = new Map<string, Picture>();
  const fieldValues: Record<string, FieldValue> = {};
  const itemElements = new Map<string, HTMLElement>();
  let helvetica: PDFFont | null = null;

  // Liberation Sans has the same widths as Helvetica and is already served
  // for pdf.js
  void new FontFace(
    "PDF Sans",
    `url("${import.meta.env.BASE_URL}pdfjs/standard_fonts/LiberationSans-Regular.ttf")`,
  )
    .load()
    .then((face) => document.fonts.add(face))
    .catch(() => undefined);

  const measureCanvas = document.createElement("canvas").getContext("2d")!;
  const textWidth = (text: string, size: number) => {
    if (helvetica && fitsStandardFont(text)) {
      return helvetica.widthOfTextAtSize(text, size);
    }
    measureCanvas.font = `${size}px ${TEXT_FONT}`;
    return measureCanvas.measureText(text).width;
  };
  const sizeText = (item: Item) => {
    const size = item.size ?? 12;
    item.rect.width = Math.max(size * 0.5, textWidth(item.text || " ", size));
    item.rect.height = size * LINE_HEIGHT;
  };

  const status = statusArea();
  const signature = signatureDialog((picture) => {
    pictures.set(picture.id, picture);
    arm("image", picture.id);
  });

  // Opening a file
  const open = async (files: InputFile[]) => {
    const file = files[0];
    await runTask(status, [], async () => {
      if (!isPdf(file)) {
        throw new UserError(`"${file.name}" is not a PDF.`);
      }
      status.progress("Opening the PDF…");
      // pdf-lib checks the file can be changed and reads its form
      const doc = await loadPdf(file.bytes);
      const fields = readFields(doc);
      const pdf = await openPdf(file.bytes);
      if (session) {
        await closePdf(session.pdf);
      }
      const fieldIds = new Map<string, { id: string; exportValue?: string }[]>();
      if (fields.length) {
        // newer pdf.js versions return a Map
        const objects: unknown = (await pdf.getFieldObjects()) ?? {};
        const entries =
          objects instanceof Map
            ? [...objects.entries()]
            : Object.entries(objects as Record<string, unknown>);
        for (const [name, widgets] of entries) {
          fieldIds.set(
            name,
            (widgets as { id: string; exportValues?: string }[]).map((w) => ({
              id: w.id,
              exportValue: w.exportValues,
            })),
          );
        }
      }
      session = { file, pdf, pages: [], fields, fieldIds };
      items = [];
      history.length = 0;
      selected = null;
      armed = null;
      for (const key of Object.keys(fieldValues)) {
        delete fieldValues[key];
      }
      await buildPages();
      buildFields();
      status.clear();
      start.hidden = true;
      workspace.hidden = false;
      document.body.classList.add("editing");
      fileInfo.replaceChildren(
        h("strong", {}, file.name),
        ` · ${pdf.numPages} page${pdf.numPages === 1 ? "" : "s"}`,
        fields.length
          ? ` · ${fields.length} form field${fields.length === 1 ? "" : "s"}`
          : "",
      );
      zoom = fitZoom(
        viewer.clientWidth,
        session.pages.map((page) => page.width),
      );
      applyZoom(zoom, false);
      viewer.scrollTop = 0;
      refresh();
    });
  };

  const drop = dropZone({
    accept: "application/pdf,.pdf",
    multiple: false,
    label: "Choose a PDF",
    hint: "or drop it here",
    onFiles: open,
  });

  // Pages
  const pagesElement = h("div", { class: "pages" });
  const viewer = h(
    "div",
    { class: "viewer", role: "region", "aria-label": "Pages", tabindex: 0 },
    pagesElement,
  );
  let observer: IntersectionObserver | null = null;

  const buildPages = async () => {
    const { pdf } = session!;
    observer?.disconnect();
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const page = session?.pages.find((p) => p.element === entry.target);
          if (page) {
            page.visible = entry.isIntersecting;
          }
        }
        scheduleRender();
      },
      { root: viewer, rootMargin: "400px 0px" },
    );
    const pages: PageView[] = [];
    for (let index = 0; index < pdf.numPages; index++) {
      const page = await pdf.getPage(index + 1);
      const viewport = page.getViewport({ scale: 1 });
      const layer = h("div", {
        class: "page__layer",
        "aria-label": `Page ${index + 1}`,
      });
      const element = h(
        "div",
        { class: "page" },
        h("span", { class: "page__number", "aria-hidden": "true" }, String(index + 1)),
        layer,
      );
      const view: PageView = {
        index,
        width: viewport.width,
        height: viewport.height,
        element,
        layer,
        canvas: null,
        renderedZoom: 0,
        visible: false,
      };
      layer.addEventListener("click", (event) => onPageClick(view, event as MouseEvent));
      layer.addEventListener("keydown", (event) => {
        if (armed && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          place(view, { x: view.width / 2, y: Math.min(view.height / 2, 120) });
        }
      });
      pages.push(view);
      observer.observe(element);
    }
    session!.pages = pages;
    pagesElement.replaceChildren(...pages.map((page) => page.element));
    for (const element of itemElements.values()) {
      element.remove();
    }
    itemElements.clear();
  };

  let rendering = false;
  let renderTimer = 0;
  const scheduleRender = (delay = 60) => {
    clearTimeout(renderTimer);
    renderTimer = window.setTimeout(() => void renderVisible(), delay);
  };
  const renderVisible = async () => {
    if (rendering || !session) {
      return;
    }
    rendering = true;
    const current = session;
    try {
      for (;;) {
        const page = current.pages.find((p) => p.visible && p.renderedZoom !== zoom);
        if (!page || session !== current) {
          break;
        }
        const target = zoom;
        const proxy = await current.pdf.getPage(page.index + 1);
        const ratio = window.devicePixelRatio || 1;
        const scale = safeScale(page.width, page.height, target * ratio);
        const canvas = await renderPage(proxy, scale, 0, AnnotationMode.ENABLE_STORAGE);
        canvas.className = "page__canvas";
        canvas.setAttribute("aria-hidden", "true");
        if (session !== current) {
          break;
        }
        page.canvas?.remove();
        page.canvas = canvas;
        page.element.prepend(canvas);
        page.renderedZoom = target;
      }
    } catch (error) {
      console.error(error);
    } finally {
      rendering = false;
    }
    if (session && session.pages.some((p) => p.visible && p.renderedZoom !== zoom)) {
      scheduleRender();
    }
  };

  const applyZoom = (next: number, keepCentre = true) => {
    const old = zoom;
    zoom = clampZoom(next);
    const centre = viewer.scrollTop + viewer.clientHeight / 2;
    viewer.style.setProperty("--zoom", String(zoom));
    for (const page of session?.pages ?? []) {
      page.element.style.width = `${page.width * zoom}px`;
      page.element.style.height = `${page.height * zoom}px`;
    }
    for (const item of items) {
      layoutItem(item);
    }
    if (keepCentre && old) {
      viewer.scrollTop = centre * (zoom / old) - viewer.clientHeight / 2;
    }
    // pages narrower than the widest one are centred, so start in the middle
    viewer.scrollLeft = (viewer.scrollWidth - viewer.clientWidth) / 2;
    zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
    zoomOut.disabled = zoom <= 0.25;
    zoomIn.disabled = zoom >= 4;
    scheduleRender(150);
  };

  // Items
  const pageOf = (item: Item) => session!.pages[item.page];
  const findItem = (id: string | null) => items.find((item) => item.id === id);

  const snapshot = () => structuredClone(items);
  const pushHistory = (state = snapshot()) => {
    history.push(state);
    if (history.length > 100) {
      history.shift();
    }
    undoButton.disabled = false;
  };
  const undo = () => {
    const state = history.pop();
    if (!state) {
      return;
    }
    items = state;
    if (!findItem(selected)) {
      selected = null;
    }
    refresh();
  };

  const layoutItem = (item: Item) => {
    const element = itemElements.get(item.id);
    if (!element) {
      return;
    }
    const { x, y, width, height } = item.rect;
    element.style.left = `${x * zoom}px`;
    element.style.top = `${y * zoom}px`;
    element.style.width = `${width * zoom}px`;
    element.style.height = `${height * zoom}px`;
    if (item.kind === "text" || item.kind === "date") {
      element.style.fontSize = `${(item.size ?? 12) * zoom}px`;
      const text = element.querySelector(".item__text")!;
      if (text.textContent !== item.text) {
        text.textContent = item.text ?? "";
      }
    }
    if (item.color) {
      element.style.color = item.color;
    }
  };

  const itemLabel = (item: Item) =>
    `${ITEM_NAMES[item.kind]}${item.text ? ` “${item.text}”` : ""} on page ${item.page + 1}`;

  const createItemElement = (item: Item) => {
    const handle = h("span", { class: "item__handle", "aria-hidden": "true" });
    let content: Node | null = null;
    if (item.kind === "image") {
      content = h("img", {
        src: pictures.get(item.image!)?.url ?? "",
        alt: "",
        draggable: false,
      });
    } else if (item.kind === "text" || item.kind === "date") {
      content = h("span", { class: "item__text" });
    } else if (item.kind === "tick" || item.kind === "cross") {
      content = markSvg(item.kind);
    }
    const element = h(
      "div",
      {
        class: `item item--${item.kind}`,
        tabindex: 0,
        role: "button",
        "aria-roledescription": "placed item",
        "aria-keyshortcuts": "ArrowUp ArrowDown ArrowLeft ArrowRight Delete",
      },
      content,
      handle,
    );
    element.style.fontFamily = TEXT_FONT;
    element.style.lineHeight = String(LINE_HEIGHT);
    attachDrag(element, item.id, handle);
    element.addEventListener("keydown", (event) => onItemKey(item.id, event));
    element.addEventListener("focus", () => {
      if (selected !== item.id) {
        select(item.id, false);
      }
    });
    element.addEventListener("dblclick", () => {
      const current = findItem(item.id);
      if (current?.kind === "text" || current?.kind === "date") {
        propsText?.focus();
        propsText?.select();
      }
    });
    return element;
  };

  /** Brings the page overlay in line with `items` and the selection. */
  const refresh = () => {
    if (!session) {
      return;
    }
    const ids = new Set(items.map((item) => item.id));
    for (const [id, element] of itemElements) {
      if (!ids.has(id)) {
        element.remove();
        itemElements.delete(id);
      }
    }
    for (const item of items) {
      let element = itemElements.get(item.id);
      if (!element) {
        element = createItemElement(item);
        itemElements.set(item.id, element);
      }
      const layer = pageOf(item).layer;
      if (element.parentElement !== layer) {
        layer.append(element);
      }
      element.classList.toggle("selected", item.id === selected);
      element.setAttribute("aria-label", itemLabel(item));
      element.setAttribute("aria-pressed", String(item.id === selected));
      layoutItem(item);
    }
    undoButton.disabled = !history.length;
    renderProps();
    renderHint();
    for (const page of session.pages) {
      page.layer.tabIndex = armed ? 0 : -1;
      page.layer.setAttribute(
        "aria-label",
        armed
          ? `Page ${page.index + 1}: press Enter to place here`
          : `Page ${page.index + 1}`,
      );
      page.layer.setAttribute("role", armed ? "button" : "group");
    }
    viewer.classList.toggle("placing", !!armed);
    for (const [kind, button] of toolButtons) {
      button.setAttribute("aria-pressed", String(armed?.kind === kind));
    }
  };

  const select = (id: string | null, focus = false) => {
    selected = id;
    refresh();
    if (focus && id) {
      itemElements.get(id)?.focus({ preventScroll: true });
    }
  };

  const deleteItem = (id: string) => {
    pushHistory();
    items = items.filter((item) => item.id !== id);
    if (selected === id) {
      selected = null;
    }
    refresh();
    status.clear();
  };

  const updateItem = (id: string, change: (item: Item) => void, record = true) => {
    const item = findItem(id);
    if (!item) {
      return;
    }
    if (record) {
      pushHistory();
    }
    change(item);
    if (item.kind === "text" || item.kind === "date") {
      sizeText(item);
    }
    const page = pageOf(item);
    item.rect = clampRect(item.rect, page.width, page.height);
    layoutItem(item);
    itemElements.get(id)?.setAttribute("aria-label", itemLabel(item));
  };

  const onItemKey = (id: string, event: KeyboardEvent) => {
    const item = findItem(id);
    if (!item) {
      return;
    }
    const step = event.shiftKey ? 10 : 1;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    if (moves[event.key]) {
      event.preventDefault();
      const [dx, dy] = moves[event.key];
      updateItem(id, (it) => {
        it.rect = { ...it.rect, x: it.rect.x + dx, y: it.rect.y + dy };
      });
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      const index = items.findIndex((it) => it.id === id);
      deleteItem(id);
      const next = items.filter((it) => it.page === item.page)[Math.max(0, index - 1)];
      if (next) {
        select(next.id, true);
      } else {
        pageOf(item).layer.focus();
        viewer.focus();
      }
    } else if (event.key === "+" || event.key === "=" || event.key === "-") {
      event.preventDefault();
      const factor = event.key === "-" ? 1 / 1.1 : 1.1;
      updateItem(id, (it) => resizeBy(it, it.rect, it.size, factor));
    } else if (event.key === "Escape") {
      select(null);
    }
  };

  /** Scales an item from its starting rectangle, keeping its top-left corner. */
  const resizeBy = (
    item: Item,
    from: Rect,
    fromSize: number | undefined,
    factor: number,
  ) => {
    if (item.kind === "text" || item.kind === "date") {
      item.size =
        Math.round(Math.min(96, Math.max(4, (fromSize ?? 12) * factor)) * 10) / 10;
    } else {
      const min = item.kind === "whiteout" ? 4 : 8;
      const f = Math.max(factor, min / Math.min(from.width, from.height));
      item.rect = { ...from, width: from.width * f, height: from.height * f };
    }
  };

  const attachDrag = (element: HTMLElement, id: string, handle: HTMLElement) => {
    let drag: {
      pointer: number;
      x: number;
      y: number;
      rect: Rect;
      size?: number;
      resize: boolean;
      before: Item[];
      moved: boolean;
    } | null = null;
    element.addEventListener("pointerdown", (event) => {
      const item = findItem(id);
      if (!item || event.button > 0 || armed) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      capture(element, event.pointerId);
      if (selected !== id) {
        select(id);
      }
      element.focus({ preventScroll: true });
      drag = {
        pointer: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        rect: { ...item.rect },
        size: item.size,
        resize: event.target === handle,
        before: snapshot(),
        moved: false,
      };
    });
    element.addEventListener("pointermove", (event) => {
      if (!drag || event.pointerId !== drag.pointer) {
        return;
      }
      const dx = (event.clientX - drag.x) / zoom;
      const dy = (event.clientY - drag.y) / zoom;
      if (!drag.moved && Math.hypot(dx * zoom, dy * zoom) < 3) {
        return;
      }
      if (!drag.moved) {
        drag.moved = true;
        pushHistory(drag.before);
      }
      const from = drag.rect;
      const size = drag.size;
      updateItem(
        id,
        (item) => {
          if (!drag!.resize) {
            item.rect = { ...from, x: from.x + dx, y: from.y + dy };
          } else if (item.kind === "whiteout") {
            item.rect = {
              ...from,
              width: Math.max(4, from.width + dx),
              height: Math.max(4, from.height + dy),
            };
          } else {
            const factor = Math.max(
              (from.width + dx) / from.width,
              (from.height + dy) / from.height,
            );
            resizeBy(item, from, size, factor);
          }
          const page = pageOf(item);
          // a resize stops at the edge of the page rather than moving the item
          if (drag!.resize && item.kind !== "text" && item.kind !== "date") {
            const fit = Math.min(
              1,
              (page.width - item.rect.x) / item.rect.width,
              (page.height - item.rect.y) / item.rect.height,
            );
            if (item.kind === "whiteout") {
              item.rect.width = Math.min(item.rect.width, page.width - item.rect.x);
              item.rect.height = Math.min(item.rect.height, page.height - item.rect.y);
            } else if (fit < 1) {
              item.rect.width *= fit;
              item.rect.height *= fit;
            }
          }
        },
        false,
      );
    });
    const end = (event: PointerEvent) => {
      if (drag && event.pointerId === drag.pointer) {
        const moved = drag.moved;
        drag = null;
        if (moved) {
          renderProps();
        }
      }
    };
    element.addEventListener("pointerup", end);
    element.addEventListener("pointercancel", end);
  };

  const onPageClick = (page: PageView, event: MouseEvent) => {
    if ((event.target as Element).closest(".item")) {
      return;
    }
    if (!armed) {
      if (selected) {
        select(null);
      }
      return;
    }
    const box = page.layer.getBoundingClientRect();
    place(page, {
      x: (event.clientX - box.left) / zoom,
      y: (event.clientY - box.top) / zoom,
    });
  };

  const place = (page: PageView, point: { x: number; y: number }) => {
    if (!armed) {
      return;
    }
    const { kind, image } = armed;
    const item: Item = {
      id: newId("item"),
      kind,
      page: page.index,
      rect: { x: 0, y: 0, width: 0, height: 0 },
    };
    const bounds = { width: page.width, height: page.height };
    if (kind === "text" || kind === "date") {
      item.text = kind === "date" ? formatDate(new Date()) : "Your text";
      item.size = kind === "date" ? 12 : 14;
      item.color = "#000000";
      sizeText(item);
      item.rect = clampRect(
        { ...item.rect, x: point.x, y: point.y - item.rect.height / 2 },
        page.width,
        page.height,
      );
    } else if (kind === "image") {
      const picture = pictures.get(image!)!;
      const size = fitInside(picture.width, picture.height, 160, 56);
      item.image = image;
      item.rect = centredRect(point, size, bounds);
    } else if (kind === "tick" || kind === "cross") {
      item.color = "#000000";
      item.rect = centredRect(point, { width: 14, height: 14 }, bounds);
    } else {
      item.rect = centredRect(point, { width: 120, height: 22 }, bounds);
    }
    pushHistory();
    items.push(item);
    if (kind !== "tick" && kind !== "cross") {
      armed = null;
    }
    selected = item.id;
    refresh();
    status.clear();
    if (kind === "text") {
      propsText?.focus();
      propsText?.select();
    } else {
      itemElements.get(item.id)?.focus({ preventScroll: true });
    }
  };

  const arm = (kind: ItemKind, image?: string) => {
    armed = { kind, image };
    selected = null;
    refresh();
  };

  // Toolbar
  const toolButtons = new Map<ItemKind, HTMLButtonElement>();
  const toolButton = (kind: ItemKind, label: string, onClick: () => void) => {
    const button = h(
      "button",
      { type: "button", class: "tool", "aria-pressed": "false", on: { click: onClick } },
      svgIcon(ICONS[kind]),
      h("span", {}, label),
    );
    toolButtons.set(kind, button);
    return button;
  };
  const toggleArm = (kind: ItemKind) => () => {
    if (armed?.kind === kind) {
      armed = null;
      refresh();
    } else {
      arm(kind);
    }
  };
  const tools = h(
    "div",
    { class: "toolbar__group", role: "group", "aria-label": "Add to the page" },
    toolButton("image", "Signature", () => signature.open()),
    toolButton("text", "Text", toggleArm("text")),
    toolButton("date", "Date", toggleArm("date")),
    toolButton("tick", "Tick", toggleArm("tick")),
    toolButton("cross", "Cross", toggleArm("cross")),
    toolButton("whiteout", "White-out", toggleArm("whiteout")),
  );
  const undoButton = h(
    "button",
    { type: "button", class: "tool", disabled: true, on: { click: undo } },
    svgIcon(
      '<path d="M9 14L4 9l5-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 9h10a6 6 0 010 12h-3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    ),
    h("span", {}, "Undo"),
  );
  const zoomOut = iconButton("Zoom out", "−", () => applyZoom(zoom / 1.25));
  const zoomIn = iconButton("Zoom in", "+", () => applyZoom(zoom * 1.25));
  const zoomLabel = h("output", { class: "zoom-label", "aria-live": "polite" }, "100%");
  const fitButton = h(
    "button",
    {
      type: "button",
      class: "fit-button",
      on: {
        click: () =>
          applyZoom(
            fitZoom(viewer.clientWidth, session?.pages.map((page) => page.width) ?? []),
          ),
      },
    },
    "Fit width",
  );
  const toolbar = h(
    "div",
    { class: "toolbar" },
    tools,
    h(
      "div",
      { class: "toolbar__group toolbar__view", role: "group", "aria-label": "View" },
      undoButton,
      h("span", { class: "zoom" }, zoomOut, zoomLabel, zoomIn),
      fitButton,
    ),
  );

  // Hint and properties of the selected item
  const hint = h("div", { class: "hint", "aria-live": "polite" });
  const renderHint = () => {
    if (!armed) {
      hint.hidden = true;
      hint.replaceChildren();
      return;
    }
    const multiple = armed.kind === "tick" || armed.kind === "cross";
    hint.hidden = false;
    hint.replaceChildren(
      h("p", {}, HINTS[armed.kind]),
      h(
        "button",
        {
          type: "button",
          class: multiple ? "primary" : "",
          on: {
            click: () => {
              armed = null;
              refresh();
            },
          },
        },
        multiple ? "Done" : "Cancel",
      ),
    );
  };

  const props = h("div", { class: "props", "aria-label": "Selected item" });
  let propsText: HTMLInputElement | null = null;
  let propsFor: string | null = null;
  const renderProps = () => {
    const item = findItem(selected);
    if (!item || armed) {
      props.hidden = true;
      props.replaceChildren();
      propsFor = null;
      propsText = null;
      return;
    }
    props.hidden = false;
    if (propsFor === item.id && props.contains(document.activeElement)) {
      return;
    }
    propsFor = item.id;
    let editing = false;
    const recordOnce = () => {
      if (!editing) {
        editing = true;
        pushHistory();
      }
    };
    const stopEditing = () => {
      editing = false;
    };
    const controls: Node[] = [
      h("p", { class: "props__title" }, itemLabel(item).replace(/ “.*”/, "")),
    ];
    propsText = null;
    if (item.kind === "text" || item.kind === "date") {
      propsText = h("input", {
        type: "text",
        value: item.text ?? "",
        on: {
          input: () => {
            recordOnce();
            updateItem(item.id, (it) => (it.text = propsText!.value), false);
          },
          change: stopEditing,
          keydown: (event) => {
            if ((event as KeyboardEvent).key === "Enter") {
              itemElements.get(item.id)?.focus();
            }
          },
        },
      });
      const sizeInput = h("input", {
        type: "number",
        min: 4,
        max: 96,
        step: 1,
        value: String(item.size ?? 12),
        inputMode: "numeric",
        on: {
          input: () => {
            const size = Number(sizeInput.value);
            if (size >= 4 && size <= 96) {
              recordOnce();
              updateItem(item.id, (it) => (it.size = size), false);
            }
          },
          change: stopEditing,
        },
      });
      controls.push(
        h(
          "div",
          { class: "props__text" },
          field(item.kind === "date" ? "Date" : "Text", propsText),
        ),
        h("div", { class: "props__size" }, field("Size (pt)", sizeInput)),
      );
    }
    if (item.color) {
      const colourInput = h("input", {
        type: "color",
        value: item.color,
        on: {
          input: () => {
            recordOnce();
            updateItem(item.id, (it) => (it.color = colourInput.value), false);
          },
          change: stopEditing,
        },
      });
      controls.push(field("Colour", colourInput));
    }
    if (item.kind !== "text" && item.kind !== "date") {
      controls.push(
        h("p", { class: "note props__note" }, "Drag to move, drag the corner to resize."),
      );
    }
    controls.push(
      h(
        "button",
        {
          type: "button",
          class: "danger",
          on: { click: () => deleteItem(item.id) },
        },
        "Delete",
      ),
    );
    props.classList.toggle("props--text", !!propsText);
    props.replaceChildren(...controls);
  };

  // Form fields
  const fieldsPanel = h("section", {
    class: "side-panel",
    "aria-labelledby": "fields-heading",
  });
  const flattenBox = h("input", { type: "checkbox" });
  let previewTimer = 0;
  const previewFields = () => {
    clearTimeout(previewTimer);
    previewTimer = window.setTimeout(() => {
      if (!session) {
        return;
      }
      const storage = session.pdf.annotationStorage;
      for (const [name, value] of Object.entries(fieldValues)) {
        const formField = session.fields.find((f) => f.name === name);
        for (const widget of session.fieldIds.get(name) ?? []) {
          if (formField?.kind === "radio") {
            storage.setValue(widget.id, { value: widget.exportValue === value });
          } else if (formField?.kind === "choice") {
            storage.setValue(widget.id, { value: value ? [String(value)] : [] });
          } else {
            storage.setValue(widget.id, { value });
          }
        }
      }
      for (const page of session.pages) {
        page.renderedZoom = 0;
      }
      scheduleRender(0);
    }, 300);
  };
  const buildFields = () => {
    const fields = session!.fields;
    fieldsPanel.hidden = !fields.length;
    flattenBox.checked = false;
    if (!fields.length) {
      fieldsPanel.replaceChildren();
      return;
    }
    const setValue = (name: string, value: FieldValue) => {
      fieldValues[name] = value;
      previewFields();
    };
    const controls = fields.map((formField) => {
      const disabled = formField.readOnly;
      if (formField.kind === "checkbox") {
        return h(
          "label",
          { class: "check" },
          h("input", {
            type: "checkbox",
            checked: formField.value === true,
            disabled,
            on: {
              change: (event) =>
                setValue(formField.name, (event.target as HTMLInputElement).checked),
            },
          }),
          h("span", {}, formField.label),
        );
      }
      if (formField.kind === "choice" || formField.kind === "radio") {
        const input = h(
          "select",
          {
            disabled,
            on: {
              change: (event) =>
                setValue(formField.name, (event.target as HTMLSelectElement).value),
            },
          },
          h("option", { value: "" }, "Not chosen"),
          ...formField.options.map((option) =>
            h("option", { value: option, selected: option === formField.value }, option),
          ),
        );
        return h("label", { class: "field" }, h("span", {}, formField.label), input);
      }
      const onInput = (event: Event) =>
        setValue(formField.name, (event.target as HTMLInputElement).value);
      if (formField.multiline) {
        const textarea = h("textarea", {
          rows: 3,
          disabled,
          maxLength: formField.maxLength ?? undefined,
          on: { input: onInput },
        });
        textarea.value = String(formField.value);
        return h("label", { class: "field" }, h("span", {}, formField.label), textarea);
      }
      const input = h("input", {
        type: "text",
        value: String(formField.value),
        disabled,
        maxLength: formField.maxLength ?? undefined,
        on: { input: onInput },
      });
      return field(formField.label, input);
    });
    fieldsPanel.replaceChildren(
      h("h3", { id: "fields-heading" }, "Form fields"),
      h("p", { class: "note" }, "This PDF has fields you can fill in."),
      h("div", { class: "fields" }, ...controls),
      h(
        "label",
        { class: "check" },
        flattenBox,
        h(
          "span",
          {},
          "Flatten the form",
          h(
            "small",
            {},
            "Turns the fields into plain content that can no longer be edited.",
          ),
        ),
      ),
    );
  };

  // Saving
  const textPicture = async (item: Item): Promise<Item> => {
    const scale = 4;
    const size = (item.size ?? 12) * scale;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(item.rect.width * scale));
    canvas.height = Math.max(1, Math.ceil(item.rect.height * scale));
    const ctx = canvas.getContext("2d")!;
    ctx.font = `${size}px ${TEXT_FONT}`;
    ctx.fillStyle = item.color ?? "#000";
    ctx.fillText(item.text ?? "", 0, textBaseline(item.size ?? 12) * scale);
    const bytes = await blobBytes(await canvasToBlob(canvas, "image/png"));
    const id = newId("text");
    pictures.set(id, {
      id,
      bytes,
      url: bytesDataUrl(bytes),
      width: canvas.width,
      height: canvas.height,
    });
    return { ...item, kind: "image", image: id, text: undefined };
  };

  const save = async () => {
    if (!session) {
      return;
    }
    const current = session;
    const changedFields = Object.keys(fieldValues).length;
    if (!items.length && !changedFields && !flattenBox.checked) {
      throw new UserError("Add a signature, text or mark to a page first.");
    }
    status.progress("Saving the PDF…");
    const ready = await Promise.all(
      items.map((item) =>
        item.text && !fitsStandardFont(item.text) ? textPicture(item) : item,
      ),
    );
    const images = new Map<string, Uint8Array>();
    for (const item of ready) {
      if (item.image) {
        images.set(item.image, pictures.get(item.image)!.bytes);
      }
    }
    const bytes = await stampPdf(current.file.bytes, {
      items: ready,
      images,
      fields: fieldValues,
      flatten: flattenBox.checked,
    });
    const parts = [
      items.length && `${items.length} item${items.length === 1 ? "" : "s"} added`,
      changedFields &&
        `${changedFields} field${changedFields === 1 ? "" : "s"} filled in`,
      flattenBox.checked && "form flattened",
    ].filter(Boolean);
    status.result({
      message: "Your signed PDF is ready.",
      detail: parts.length ? `${parts.join(", ")}.` : undefined,
      file: {
        bytes,
        name: outputName(current.file.name, "signed"),
        type: "application/pdf",
      },
    });
  };

  const saveButton = h(
    "button",
    {
      type: "button",
      class: "primary",
      on: { click: () => runTask(status, [saveButton], save) },
    },
    "Save signed PDF",
  );
  const fileInfo = h("p", { class: "file-info" });
  const docbar = h(
    "div",
    { class: "docbar" },
    fileInfo,
    h(
      "div",
      { class: "actions" },
      h(
        "button",
        { type: "button", on: { click: () => drop.open() } },
        "Open another PDF",
      ),
      saveButton,
    ),
  );

  const tips = h(
    "section",
    { class: "side-panel", "aria-labelledby": "tips-heading" },
    h("h3", { id: "tips-heading" }, "How it works"),
    h(
      "ol",
      { class: "tips" },
      h("li", {}, "Choose a tool, then tap on a page to place it."),
      h("li", {}, "Drag items to move them, and drag the corner to resize."),
      h("li", {}, "Select an item to change its text, size or colour, or to delete it."),
      h("li", {}, "Save to download the PDF with everything added."),
    ),
  );

  const workspace = h(
    "div",
    { class: "workspace" },
    docbar,
    status.element,
    toolbar,
    hint,
    props,
    h(
      "div",
      { class: "editor" },
      viewer,
      h("aside", { class: "side" }, fieldsPanel, tips),
    ),
  );
  workspace.hidden = true;
  const start = h("div", { class: "start" }, drop.element);

  container.append(start, workspace, signature.element);

  document.addEventListener("keydown", (event) => {
    if (workspace.hidden || signature.element.open) {
      return;
    }
    const target = event.target as HTMLElement;
    const typing = target.matches("input, textarea, select");
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !typing) {
      event.preventDefault();
      undo();
    } else if (event.key === "Escape" && armed) {
      armed = null;
      refresh();
    }
  });

  // Text is measured with Helvetica's own widths, so the box on screen
  // matches the text written into the PDF
  void (async () => {
    const doc = await PDFDocument.create();
    helvetica = await doc.embedFont(StandardFonts.Helvetica);
    for (const item of items) {
      if (item.kind === "text" || item.kind === "date") {
        sizeText(item);
        layoutItem(item);
      }
    }
  })();

  return { open };
};
