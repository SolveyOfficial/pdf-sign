// The "Add your signature" dialog: draw, type or upload a signature, and
// optionally remember it on this device.
import { canvasToBlob, blobBytes } from "./lib/render";
import { UserError } from "./lib/errors";
import { bytesDataUrl, dataUrlBytes, removeWhite, trimBounds } from "./lib/image";
import { forget, forgetAll, loadSaved, remember } from "./lib/storage";
import { capture, field, h } from "./ui";

/** A PNG picture placed on pages, such as a signature. */
export interface Picture {
  id: string;
  bytes: Uint8Array;
  /** Address to show it in the page, e.g. a data: URL. */
  url: string;
  width: number;
  height: number;
}

export const INKS = [
  { value: "#111111", label: "Black" },
  { value: "#1a3fa0", label: "Blue" },
] as const;

export const SIGNATURE_FONTS = [
  { family: "Caveat", label: "Caveat" },
  { family: "Dancing Script", label: "Dancing Script" },
] as const;

type Mode = "draw" | "type" | "upload";
type Point = { x: number; y: number };

let pictureCount = 0;
export const newId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${(++pictureCount).toString(36)}`;

/** Crops a canvas to its ink and returns it as a PNG picture. */
const canvasPicture = async (canvas: HTMLCanvasElement, padding: number) => {
  const ctx = canvas.getContext("2d")!;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const bounds = trimBounds(data, canvas.width, canvas.height, padding);
  if (!bounds) {
    return null;
  }
  const out = document.createElement("canvas");
  out.width = bounds.width;
  out.height = bounds.height;
  out
    .getContext("2d")!
    .drawImage(
      canvas,
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
      0,
      0,
      bounds.width,
      bounds.height,
    );
  const bytes = await blobBytes(await canvasToBlob(out, "image/png"));
  return {
    id: newId("sig"),
    bytes,
    url: bytesDataUrl(bytes),
    width: bounds.width,
    height: bounds.height,
  };
};

const drawStrokes = (
  ctx: CanvasRenderingContext2D,
  strokes: Point[][],
  scale: number,
  color: string,
  width: number,
) => {
  ctx.save();
  ctx.scale(scale, scale);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const points of strokes) {
    if (points.length === 1) {
      ctx.beginPath();
      ctx.arc(points[0].x, points[0].y, width / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length - 1; i++) {
      const mid = {
        x: (points[i].x + points[i + 1].x) / 2,
        y: (points[i].y + points[i + 1].y) / 2,
      };
      ctx.quadraticCurveTo(points[i].x, points[i].y, mid.x, mid.y);
    }
    const last = points[points.length - 1];
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
  }
  ctx.restore();
};

/** A row of toggle buttons where one is chosen. */
const segmented = <T extends string>(
  label: string,
  options: readonly { value: T; label: string; style?: string }[],
  initial: T,
  onChange: (value: T) => void,
) => {
  let value = initial;
  const buttons = options.map((option) =>
    h(
      "button",
      {
        type: "button",
        class: "segment",
        "aria-pressed": String(option.value === initial),
        style: option.style,
        on: {
          click: () => {
            value = option.value;
            for (const [i, button] of buttons.entries()) {
              button.setAttribute("aria-pressed", String(options[i].value === value));
            }
            onChange(value);
          },
        },
      },
      option.label,
    ),
  );
  return {
    element: h(
      "div",
      { class: "segmented-field" },
      h("span", { class: "segmented-field__label" }, label),
      h("div", { class: "segmented", role: "group", "aria-label": label }, ...buttons),
    ),
    get value() {
      return value;
    },
  };
};

export const signatureDialog = (onUse: (picture: Picture) => void) => {
  /** Signatures made in this visit, newest first. */
  const recent: Picture[] = [];
  let mode: Mode = "draw";
  let ink: string = INKS[0].value;
  let thickness = 3;

  // Draw
  const strokes: Point[][] = [];
  const pad = h("canvas", {
    class: "pad",
    role: "img",
    "aria-label": "Signature pad",
  });
  const padContext = pad.getContext("2d")!;
  const redraw = () => {
    padContext.clearRect(0, 0, pad.width, pad.height);
    drawStrokes(padContext, strokes, pad.width / pad.clientWidth || 1, ink, thickness);
    padEmpty.hidden = strokes.length > 0;
  };
  const sizePad = () => {
    const ratio = window.devicePixelRatio || 1;
    pad.width = Math.round(pad.clientWidth * ratio);
    pad.height = Math.round(pad.clientHeight * ratio);
    redraw();
  };
  let drawing: Point[] | null = null;
  const padPoint = (event: PointerEvent): Point => {
    const box = pad.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };
  pad.addEventListener("pointerdown", (event) => {
    if (event.button > 0) {
      return;
    }
    event.preventDefault();
    capture(pad, event.pointerId);
    drawing = [padPoint(event)];
    strokes.push(drawing);
    redraw();
  });
  pad.addEventListener("pointermove", (event) => {
    if (drawing) {
      const events = event.getCoalescedEvents?.() ?? [event];
      for (const e of events.length ? events : [event]) {
        drawing.push(padPoint(e));
      }
      redraw();
    }
  });
  const endStroke = () => {
    drawing = null;
  };
  pad.addEventListener("pointerup", endStroke);
  pad.addEventListener("pointercancel", endStroke);
  const padEmpty = h("span", { class: "pad-empty", "aria-hidden": "true" }, "Sign here");

  const thicknessInput = h("input", {
    type: "range",
    min: 1,
    max: 8,
    step: 0.5,
    value: String(thickness),
    on: {
      input: () => {
        thickness = Number(thicknessInput.value);
        redraw();
      },
    },
  });

  const drawPane = h(
    "div",
    { class: "sign-pane" },
    h("div", { class: "pad-wrap" }, pad, padEmpty),
    h("p", { class: "note" }, "Draw with your mouse, finger or stylus."),
    h(
      "div",
      { class: "sign-row" },
      field("Thickness", thicknessInput),
      h(
        "button",
        {
          type: "button",
          on: {
            click: () => {
              strokes.length = 0;
              redraw();
            },
          },
        },
        "Clear",
      ),
    ),
  );

  // Type
  let font: string = SIGNATURE_FONTS[0].family;
  const nameInput = h("input", {
    type: "text",
    autocomplete: "name",
    maxLength: 60,
    on: { input: () => updatePreview() },
  });
  const typePreview = h("p", { class: "type-preview", "aria-hidden": "true" });
  const updatePreview = () => {
    typePreview.textContent = nameInput.value || "Your name";
    typePreview.style.fontFamily = `"${font}", cursive`;
    typePreview.style.color = ink;
  };
  const fontChoice = segmented(
    "Style",
    SIGNATURE_FONTS.map(({ family, label }) => ({
      value: family,
      label,
      style: `font-family: "${family}", cursive; font-size: 1.25rem`,
    })),
    font,
    (value) => {
      font = value;
      updatePreview();
    },
  );
  const typePane = h(
    "div",
    { class: "sign-pane" },
    field("Your name", nameInput),
    fontChoice.element,
    typePreview,
  );

  // Upload
  let source: ImageBitmap | null = null;
  const fileInput = h("input", {
    type: "file",
    accept: "image/png,image/jpeg,image/webp,image/gif,image/bmp",
    class: "visually-hidden",
    tabindex: -1,
    "aria-hidden": "true",
  });
  const transparent = h("input", { type: "checkbox", checked: true });
  const threshold = h("input", { type: "range", min: 120, max: 250, value: "210" });
  const uploadCanvas = h("canvas", {
    class: "upload-preview",
    role: "img",
    "aria-label": "Uploaded signature",
  });
  const uploadEmpty = h("p", { class: "note" }, "No picture chosen yet.");
  const processUpload = () => {
    if (!source) {
      uploadCanvas.hidden = true;
      uploadEmpty.hidden = false;
      return;
    }
    const scale = Math.min(1, 1200 / Math.max(source.width, source.height));
    uploadCanvas.width = Math.max(1, Math.round(source.width * scale));
    uploadCanvas.height = Math.max(1, Math.round(source.height * scale));
    const ctx = uploadCanvas.getContext("2d", { willReadFrequently: true })!;
    ctx.clearRect(0, 0, uploadCanvas.width, uploadCanvas.height);
    ctx.drawImage(source, 0, 0, uploadCanvas.width, uploadCanvas.height);
    if (transparent.checked) {
      const image = ctx.getImageData(0, 0, uploadCanvas.width, uploadCanvas.height);
      removeWhite(image.data, Number(threshold.value));
      ctx.putImageData(image, 0, 0);
    }
    uploadCanvas.hidden = false;
    uploadEmpty.hidden = true;
  };
  transparent.addEventListener("change", () => {
    threshold.disabled = !transparent.checked;
    processUpload();
  });
  threshold.addEventListener("input", processUpload);
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) {
      return;
    }
    try {
      source?.close();
      source = await createImageBitmap(file);
      error.hidden = true;
    } catch {
      source = null;
      showError("This picture could not be read. Try a JPG or PNG file.");
    }
    processUpload();
  });
  const uploadPane = h(
    "div",
    { class: "sign-pane" },
    h(
      "div",
      { class: "actions" },
      h(
        "button",
        { type: "button", on: { click: () => fileInput.click() } },
        "Choose a picture",
      ),
      fileInput,
    ),
    h(
      "p",
      { class: "note" },
      "A photo or scan of your signature on white paper works best.",
    ),
    h(
      "label",
      { class: "check" },
      transparent,
      h("span", {}, "Make the white background transparent"),
    ),
    field(
      "Background threshold",
      threshold,
      "Raise it if the paper still shows; lower it if the ink fades.",
    ),
    h("div", { class: "upload-wrap" }, uploadCanvas, uploadEmpty),
  );
  uploadCanvas.hidden = true;

  // Shared
  const inkChoice = segmented("Ink colour", INKS, ink, (value) => {
    ink = value;
    redraw();
    updatePreview();
  });
  const rememberBox = h("input", { type: "checkbox" });
  const error = h("p", { class: "status__error", role: "alert" });
  error.hidden = true;
  const showError = (message: string) => {
    error.textContent = message;
    error.hidden = false;
  };

  const panes: Record<Mode, HTMLElement> = {
    draw: drawPane,
    type: typePane,
    upload: uploadPane,
  };
  const tabs = (Object.keys(panes) as Mode[]).map((key) =>
    h(
      "button",
      {
        type: "button",
        class: "segment",
        "aria-pressed": String(key === mode),
        on: { click: () => setMode(key) },
      },
      { draw: "Draw", type: "Type", upload: "Upload" }[key],
    ),
  );
  const setMode = (next: Mode) => {
    mode = next;
    for (const [i, key] of (Object.keys(panes) as Mode[]).entries()) {
      panes[key].hidden = key !== mode;
      tabs[i].setAttribute("aria-pressed", String(key === mode));
    }
    inkChoice.element.hidden = mode === "upload";
    error.hidden = true;
    if (mode === "draw") {
      requestAnimationFrame(sizePad);
    }
  };

  const savedList = h("ul", { class: "saved-list" });
  const savedSection = h(
    "section",
    { class: "saved", "aria-labelledby": "saved-heading" },
    h("h3", { id: "saved-heading" }, "Your signatures"),
    savedList,
  );

  const allPictures = () => {
    const saved = loadSaved().map((s) => ({
      picture: {
        id: s.id,
        url: s.url,
        width: s.width,
        height: s.height,
        bytes: new Uint8Array(),
      },
      saved: true,
    }));
    const savedIds = new Set(saved.map((s) => s.picture.id));
    return [
      ...recent
        .filter((p) => !savedIds.has(p.id))
        .map((picture) => ({ picture, saved: false })),
      ...saved,
    ];
  };

  const renderSaved = () => {
    const list = allPictures();
    savedSection.hidden = !list.length;
    const anySaved = list.some((entry) => entry.saved);
    savedList.replaceChildren(
      ...list.map(({ picture, saved }, index) =>
        h(
          "li",
          { class: "saved-item" },
          h("img", {
            src: picture.url,
            alt: `Signature ${index + 1}`,
            class: "saved-item__image",
          }),
          h(
            "span",
            { class: "saved-item__note" },
            saved ? "Remembered on this device" : "This visit only",
          ),
          h(
            "span",
            { class: "saved-item__actions" },
            h(
              "button",
              {
                type: "button",
                class: "primary",
                "aria-label": `Use signature ${index + 1}`,
                on: { click: () => use(picture) },
              },
              "Use",
            ),
            saved &&
              h(
                "button",
                {
                  type: "button",
                  class: "danger",
                  "aria-label": `Forget signature ${index + 1}`,
                  on: {
                    click: () => {
                      forget(picture.id);
                      renderSaved();
                    },
                  },
                },
                "Forget",
              ),
          ),
        ),
      ),
      ...(anySaved
        ? [
            h(
              "li",
              { class: "saved-forget-all" },
              h(
                "button",
                {
                  type: "button",
                  class: "link-button",
                  on: {
                    click: () => {
                      forgetAll();
                      renderSaved();
                    },
                  },
                },
                "Forget all signatures saved on this device",
              ),
            ),
          ]
        : []),
    );
  };

  const use = (picture: Picture) => {
    const full = picture.bytes.length
      ? picture
      : { ...picture, bytes: dataUrlBytes(picture.url) };
    dialog.close();
    onUse(full);
  };

  const create = async () => {
    let picture: Picture | null;
    if (mode === "draw") {
      if (!strokes.length) {
        throw new UserError("Draw your signature in the box first.");
      }
      const scale = 3;
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(pad.clientWidth * scale);
      canvas.height = Math.round(pad.clientHeight * scale);
      drawStrokes(canvas.getContext("2d")!, strokes, scale, ink, thickness);
      picture = await canvasPicture(canvas, Math.ceil(thickness * scale));
    } else if (mode === "type") {
      const name = nameInput.value.trim();
      if (!name) {
        throw new UserError("Type your name first.");
      }
      const size = 160;
      const css = `${size}px "${font}", cursive`;
      await document.fonts.load(css, name);
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d")!;
      ctx.font = css;
      canvas.width = Math.ceil(ctx.measureText(name).width + size);
      canvas.height = Math.ceil(size * 1.8);
      ctx.font = css;
      ctx.fillStyle = ink;
      ctx.textBaseline = "alphabetic";
      ctx.fillText(name, size / 2, size * 1.2);
      picture = await canvasPicture(canvas, 12);
    } else {
      if (!source) {
        throw new UserError("Choose a picture of your signature first.");
      }
      picture = await canvasPicture(uploadCanvas, 4);
      if (!picture) {
        throw new UserError(
          "Nothing is left of the picture. Lower the background threshold and try again.",
        );
      }
    }
    if (!picture) {
      throw new UserError("The signature is empty.");
    }
    recent.unshift(picture);
    if (rememberBox.checked) {
      const ok = remember({
        id: picture.id,
        url: picture.url,
        width: picture.width,
        height: picture.height,
      });
      if (!ok) {
        throw new UserError(
          "This browser would not keep the signature. Untick “Remember on this device” to use it for this visit only.",
        );
      }
    }
    return picture;
  };

  const useButton = h("button", { type: "submit", class: "primary" }, "Use signature");

  const dialog = h(
    "dialog",
    { class: "sign-dialog", "aria-labelledby": "sign-heading" },
    h(
      "form",
      {
        method: "dialog",
        on: {
          submit: async (event) => {
            event.preventDefault();
            useButton.disabled = true;
            useButton.textContent = "Preparing…";
            try {
              const picture = await create();
              use(picture);
            } catch (e) {
              if (!(e instanceof UserError)) {
                console.error(e);
              }
              showError(e instanceof Error ? e.message : String(e));
            } finally {
              useButton.disabled = false;
              useButton.textContent = "Use signature";
            }
          },
        },
      },
      h(
        "div",
        { class: "sign-dialog__head" },
        h("h2", { id: "sign-heading" }, "Add your signature"),
        h(
          "button",
          {
            type: "button",
            class: "icon-button",
            "aria-label": "Close",
            title: "Close",
            on: { click: () => dialog.close() },
          },
          "✕",
        ),
      ),
      savedSection,
      h(
        "div",
        { class: "segmented", role: "group", "aria-label": "How to sign" },
        ...tabs,
      ),
      drawPane,
      typePane,
      uploadPane,
      inkChoice.element,
      h(
        "label",
        { class: "check" },
        rememberBox,
        h(
          "span",
          {},
          "Remember on this device",
          h(
            "small",
            {},
            "Kept in this browser only, so you can use it next time. You can forget it at any time.",
          ),
        ),
      ),
      error,
      h(
        "div",
        { class: "actions sign-dialog__actions" },
        h("button", { type: "button", on: { click: () => dialog.close() } }, "Cancel"),
        useButton,
      ),
    ),
  );

  window.addEventListener("resize", () => {
    if (dialog.open && mode === "draw") {
      sizePad();
    }
  });

  return {
    element: dialog,
    open: () => {
      error.hidden = true;
      renderSaved();
      setMode(mode);
      updatePreview();
      dialog.showModal();
      sizePad();
    },
  };
};
