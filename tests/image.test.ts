import { describe, expect, it } from "vitest";

import { bytesDataUrl, dataUrlBytes, removeWhite, trimBounds } from "../src/lib/image";

const pixels = (...values: number[][]) => new Uint8ClampedArray(values.flat());

describe("removeWhite", () => {
  it("clears white, keeps ink and fades the edge", () => {
    const data = pixels(
      [255, 255, 255, 255], // paper
      [20, 20, 120, 255], // blue ink
      [190, 190, 190, 255], // light grey, between the limits
      [240, 238, 230, 255], // off-white paper
    );
    removeWhite(data, 210);
    expect(data[3]).toBe(0);
    expect(data[7]).toBe(255);
    expect(data[11]).toBe(Math.round((255 * 20) / 40));
    expect(data[15]).toBe(0);
  });

  it("keeps colours unchanged", () => {
    const data = pixels([10, 20, 30, 255]);
    removeWhite(data, 200);
    expect([...data]).toEqual([10, 20, 30, 255]);
  });
});

describe("trimBounds", () => {
  // a 4 x 3 picture with ink at (1, 1) and (2, 1)
  const picture = () => {
    const data = new Uint8ClampedArray(4 * 3 * 4);
    data[(1 * 4 + 1) * 4 + 3] = 255;
    data[(1 * 4 + 2) * 4 + 3] = 255;
    return data;
  };

  it("finds the ink", () => {
    expect(trimBounds(picture(), 4, 3)).toEqual({ x: 1, y: 1, width: 2, height: 1 });
  });

  it("adds padding without leaving the picture", () => {
    expect(trimBounds(picture(), 4, 3, 5)).toEqual({ x: 0, y: 0, width: 4, height: 3 });
    expect(trimBounds(picture(), 4, 3, 1)).toEqual({ x: 0, y: 0, width: 4, height: 3 });
  });

  it("returns null for an empty picture", () => {
    expect(trimBounds(new Uint8ClampedArray(16), 2, 2)).toBeNull();
  });

  it("ignores nearly transparent pixels", () => {
    const data = new Uint8ClampedArray(16);
    data[3] = 3;
    expect(trimBounds(data, 2, 2)).toBeNull();
  });
});

describe("data URLs", () => {
  it("round-trips bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 137, 80, 78, 71]);
    const url = bytesDataUrl(bytes);
    expect(url.startsWith("data:image/png;base64,")).toBe(true);
    expect([...dataUrlBytes(url)]).toEqual([...bytes]);
  });

  it("handles large inputs", () => {
    const bytes = new Uint8Array(100_000).map((_, i) => i % 256);
    expect(dataUrlBytes(bytesDataUrl(bytes))).toEqual(bytes);
  });
});
