import { describe, expect, it } from "vitest";

import {
  fitsStandardFont,
  formatBytes,
  formatDate,
  hexToRgb,
  isPdf,
  outputName,
} from "../src/lib/text";

describe("formatDate", () => {
  it("writes DD/MM/YYYY with leading zeros", () => {
    expect(formatDate(new Date(2026, 0, 5))).toBe("05/01/2026");
    expect(formatDate(new Date(2026, 11, 31))).toBe("31/12/2026");
  });
});

describe("outputName", () => {
  it("adds -signed before the extension", () => {
    expect(outputName("contract.pdf", "signed")).toBe("contract-signed.pdf");
    expect(outputName("a.b.PDF", "signed")).toBe("a.b-signed.pdf");
    expect(outputName(".pdf", "signed")).toBe("document-signed.pdf");
  });
});

describe("hexToRgb", () => {
  it("reads six and three digit colours", () => {
    expect(hexToRgb("#ff0000")).toEqual({ r: 1, g: 0, b: 0 });
    expect(hexToRgb("#1a3fa0")).toEqual({ r: 26 / 255, g: 63 / 255, b: 160 / 255 });
    expect(hexToRgb("0f0")).toEqual({ r: 0, g: 1, b: 0 });
  });

  it("falls back to black", () => {
    expect(hexToRgb("blue")).toEqual({ r: 0, g: 0, b: 0 });
  });
});

describe("fitsStandardFont", () => {
  it("accepts Latin text and common symbols", () => {
    expect(fitsStandardFont("Café 12/10/2026 – €5 “ok”")).toBe(true);
    expect(fitsStandardFont("")).toBe(true);
  });

  it("rejects other scripts and symbols", () => {
    expect(fitsStandardFont("नमस्ते")).toBe(false);
    expect(fitsStandardFont("₹100")).toBe(false);
    expect(fitsStandardFont("✓")).toBe(false);
    expect(fitsStandardFont("line\nbreak")).toBe(false);
  });
});

describe("isPdf and formatBytes", () => {
  it("recognises PDFs by type or name", () => {
    expect(isPdf({ name: "a.PDF", type: "" })).toBe(true);
    expect(isPdf({ name: "a", type: "application/pdf" })).toBe(true);
    expect(isPdf({ name: "a.png", type: "image/png" })).toBe(false);
  });

  it("formats sizes", () => {
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
  });
});
