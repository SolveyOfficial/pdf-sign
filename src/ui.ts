// Small helpers for building the interface without a framework.
import { UserError } from "./lib/errors";
import { download, readFile } from "./lib/files";
import { formatBytes, type InputFile } from "./lib/text";

type Child = Node | string | null | undefined | false;
type Props = Record<string, unknown> & {
  class?: string;
  on?: Record<string, (event: Event) => void>;
};

/** Creates an element: h("button", { class: "primary" }, "Save"). */
export const h = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "on") {
      for (const [type, handler] of Object.entries(
        value as Record<string, EventListener>,
      )) {
        element.addEventListener(type, handler);
      }
    } else if (key === "class") {
      element.className = String(value);
    } else if (value === true) {
      element.setAttribute(key, "");
    } else if (value !== false && value != null) {
      if (key in element && !key.includes("-")) {
        (element as unknown as Record<string, unknown>)[key] = value;
      } else {
        element.setAttribute(key, String(value));
      }
    }
  }
  element.append(...children.filter((child): child is Node | string => !!child));
  return element;
};

export interface DropZoneOptions {
  accept: string;
  multiple: boolean;
  label: string;
  hint: string;
  onFiles: (files: InputFile[]) => void | Promise<void>;
}

/** A large area to drop files on, which also opens the file picker. */
export const dropZone = (options: DropZoneOptions) => {
  const input = h("input", {
    type: "file",
    accept: options.accept,
    multiple: options.multiple,
    class: "visually-hidden",
    tabindex: -1,
    "aria-hidden": "true",
  });
  const take = async (list: FileList | null) => {
    if (list?.length) {
      const files = await Promise.all(
        [...list].slice(0, options.multiple ? undefined : 1).map(readFile),
      );
      await options.onFiles(files);
    }
  };
  input.addEventListener("change", async () => {
    await take(input.files);
    input.value = "";
  });
  const zone = h(
    "button",
    {
      type: "button",
      class: "drop-zone",
      on: {
        click: () => input.click(),
        dragover: (event) => {
          event.preventDefault();
          zone.classList.add("dragging");
        },
        dragleave: () => zone.classList.remove("dragging"),
        drop: (event) => {
          event.preventDefault();
          zone.classList.remove("dragging");
          void take((event as DragEvent).dataTransfer?.files ?? null);
        },
      },
    },
    h("span", { class: "drop-zone__label" }, options.label),
    h("span", { class: "drop-zone__hint" }, options.hint),
  );
  return { element: h("div", {}, zone, input), open: () => input.click() };
};

/** Shows progress, errors and results for a tool. */
export const statusArea = () => {
  const element = h("div", { class: "status", role: "status", "aria-live": "polite" });
  const show = (...children: Child[]) => {
    element.replaceChildren(...children.filter((c): c is Node | string => !!c));
  };
  return {
    element,
    clear: () => show(),
    progress: (message: string) =>
      show(
        h("p", { class: "status__progress" }, h("span", { class: "spinner" }), message),
      ),
    error: (error: unknown) =>
      show(
        h(
          "p",
          { class: "status__error" },
          error instanceof Error ? error.message : String(error),
        ),
      ),
    result: (options: {
      message: string;
      detail?: string;
      file: { bytes: Uint8Array; name: string; type: string };
    }) => {
      const save = () =>
        download(options.file.bytes, options.file.name, options.file.type);
      show(
        h(
          "div",
          { class: "status__result" },
          h("p", { class: "status__message" }, options.message),
          options.detail && h("p", { class: "status__detail" }, options.detail),
          h(
            "button",
            { type: "button", class: "primary", on: { click: save } },
            `Download ${options.file.name} (${formatBytes(options.file.bytes.length)})`,
          ),
        ),
      );
      save();
    },
  };
};

/** Runs a task while showing progress, and reports any error. */
export const runTask = async (
  status: ReturnType<typeof statusArea>,
  buttons: HTMLButtonElement[],
  task: () => Promise<void>,
) => {
  for (const button of buttons) {
    button.disabled = true;
  }
  try {
    await task();
  } catch (error) {
    if (!(error instanceof UserError)) {
      console.error(error);
    }
    status.error(
      error instanceof Error && /encrypt|password/i.test(error.message)
        ? new UserError(
            "This PDF is protected with a password, so it can't be changed here.",
          )
        : error,
    );
  } finally {
    for (const button of buttons) {
      button.disabled = false;
    }
  }
};

let fieldCount = 0;

/** A text or number input with a label and an optional hint below it. */
export const field = (label: string, input: HTMLInputElement, hint?: string) => {
  const id = `field-${++fieldCount}`;
  input.id = id;
  const hintElement = hint && h("small", { id: `${id}-hint` }, hint);
  if (hintElement) {
    input.setAttribute("aria-describedby", hintElement.id);
  }
  return h("div", { class: "field" }, h("label", { for: id }, label), input, hintElement);
};

export const iconButton = (
  label: string,
  icon: string,
  onClick: () => void,
  className = "",
) =>
  h(
    "button",
    {
      type: "button",
      class: `icon-button ${className}`,
      title: label,
      "aria-label": label,
      on: { click: onClick },
    },
    icon,
  );

/** Keeps sending a pointer's events to an element while it is dragged. */
export const capture = (element: Element, pointerId: number) => {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    // the pointer may already be gone, e.g. a very short tap
  }
};
