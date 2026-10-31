// Pixel helpers for signature pictures. They work on RGBA data as returned
// by a canvas's getImageData, so they can be tested without a browser.

/**
 * Makes white and near-white pixels transparent. Pixels brighter than
 * `threshold` (0 to 255) disappear; slightly darker ones fade out, which keeps
 * the edges of the ink smooth.
 */
export const removeWhite = (data: Uint8ClampedArray, threshold: number, soft = 40) => {
  const low = threshold - soft;
  for (let i = 0; i < data.length; i += 4) {
    const light = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    if (light >= threshold) {
      data[i + 3] = 0;
    } else if (light > low) {
      data[i + 3] = Math.round((data[i + 3] * (threshold - light)) / soft);
    }
  }
  return data;
};

/**
 * The smallest rectangle holding every pixel that is not (almost) fully
 * transparent, with `padding` pixels around it; null for an empty picture.
 */
export const trimBounds = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  padding = 0,
  minAlpha = 8,
) => {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] >= minAlpha) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < 0) {
    return null;
  }
  const x = Math.max(0, left - padding);
  const y = Math.max(0, top - padding);
  return {
    x,
    y,
    width: Math.min(width, right + 1 + padding) - x,
    height: Math.min(height, bottom + 1 + padding) - y,
  };
};

/** Decodes a data: URL into its bytes. */
export const dataUrlBytes = (url: string) => {
  const base64 = url.slice(url.indexOf(",") + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

/** Encodes bytes as a data: URL. */
export const bytesDataUrl = (bytes: Uint8Array, type = "image/png") => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:${type};base64,${btoa(binary)}`;
};
