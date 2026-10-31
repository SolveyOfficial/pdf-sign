// Small helpers for text, names and colours.

/** A file chosen by the user, already read into memory. */
export interface InputFile {
  name: string;
  type: string;
  bytes: Uint8Array;
}

export const isPdf = (file: Pick<InputFile, "name" | "type">) =>
  file.type === "application/pdf" || /\.pdf$/i.test(file.name);

/** Turns "report.pdf" into "report-<suffix>.pdf". */
export const outputName = (name: string, suffix: string, extension = "pdf") =>
  `${name.replace(/\.[^.]+$/, "") || "document"}-${suffix}.${extension}`;

/** Formats a byte count for people, e.g. "1.2 MB". */
export const formatBytes = (bytes: number) => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

/** Formats a date as DD/MM/YYYY. */
export const formatDate = (date: Date) =>
  [date.getDate(), date.getMonth() + 1]
    .map((part) => String(part).padStart(2, "0"))
    .concat(String(date.getFullYear()))
    .join("/");

/** Converts "#1a3fa0" (or "#13a") to red, green and blue between 0 and 1. */
export const hexToRgb = (hex: string) => {
  let value = hex.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(value)) {
    value = [...value].map((c) => c + c).join("");
  }
  if (!/^[0-9a-f]{6}$/i.test(value)) {
    return { r: 0, g: 0, b: 0 };
  }
  const n = parseInt(value, 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
};

// Characters outside Latin-1 that the standard PDF fonts can still write
const WIN_ANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");

/**
 * Whether text can be written with the standard PDF fonts (Helvetica), which
 * keeps it selectable. Other text is placed as a picture instead.
 */
export const fitsStandardFont = (text: string) =>
  [...text].every((char) => {
    const code = char.codePointAt(0)!;
    return (
      (code >= 0x20 && code <= 0x7e) ||
      (code >= 0xa0 && code <= 0xff) ||
      WIN_ANSI_EXTRA.has(char)
    );
  });
