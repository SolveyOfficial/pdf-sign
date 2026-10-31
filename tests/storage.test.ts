import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { forget, forgetAll, loadSaved, parseSaved, remember } from "../src/lib/storage";

const signature = (id: string) => ({
  id,
  url: "data:image/png;base64,iVBORw0KGgo=",
  width: 10,
  height: 5,
});

describe("parseSaved", () => {
  it("ignores missing, broken and unexpected data", () => {
    expect(parseSaved(null)).toEqual([]);
    expect(parseSaved("{oops")).toEqual([]);
    expect(parseSaved('{"id":"a"}')).toEqual([]);
    expect(
      parseSaved(
        JSON.stringify([signature("a"), { id: "b", url: "javascript:alert(1)" }, null]),
      ),
    ).toEqual([signature("a")]);
  });
});

describe("remember and forget", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the newest signatures first", () => {
    remember(signature("a"));
    remember(signature("b"));
    remember(signature("a"));
    expect(loadSaved().map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("forgets one or all", () => {
    remember(signature("a"));
    remember(signature("b"));
    forget("a");
    expect(loadSaved().map((s) => s.id)).toEqual(["b"]);
    forgetAll();
    expect(loadSaved()).toEqual([]);
  });

  it("reports when the browser refuses to store", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => undefined,
    });
    expect(remember(signature("a"))).toBe(false);
  });
});
