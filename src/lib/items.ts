// The things a user places on pages.
import type { Rect } from "./geometry";

export type ItemKind = "image" | "text" | "date" | "tick" | "cross" | "whiteout";

export interface Item {
  id: string;
  kind: ItemKind;
  /** Zero-based page index. */
  page: number;
  /** Position on the page as shown, in points. */
  rect: Rect;
  /** Text for "text" and "date" items. */
  text?: string;
  /** Font size in points for "text" and "date" items. */
  size?: number;
  /** Colour such as "#1a3fa0", for text and marks. */
  color?: string;
  /** Picture id for "image" items. */
  image?: string;
}

/** Lines of a tick and a cross, in a 0 to 1 square with y going down. */
export const MARK_LINES: Record<"tick" | "cross", [number, number][][]> = {
  tick: [
    [
      [0.12, 0.55],
      [0.4, 0.84],
      [0.9, 0.16],
    ],
  ],
  cross: [
    [
      [0.16, 0.16],
      [0.84, 0.84],
    ],
    [
      [0.84, 0.16],
      [0.16, 0.84],
    ],
  ],
};

/** Stroke width of a tick or cross, as a share of its size. */
export const MARK_STROKE = 0.13;

export const ITEM_NAMES: Record<ItemKind, string> = {
  image: "Signature",
  text: "Text",
  date: "Date",
  tick: "Tick",
  cross: "Cross",
  whiteout: "White-out",
};

/** White-outs are drawn first, so other items can sit on top of them. */
export const drawOrder = (items: Item[]) => [
  ...items.filter((item) => item.kind === "whiteout"),
  ...items.filter((item) => item.kind !== "whiteout"),
];
