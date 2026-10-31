// Signatures the user chose to remember on this device. They are kept in
// the browser's local storage only and never sent anywhere.

export interface SavedSignature {
  id: string;
  /** PNG picture as a data: URL. */
  url: string;
  width: number;
  height: number;
}

const KEY = "solvey-fill-sign:signatures";

const isSignature = (value: unknown): value is SavedSignature => {
  const v = value as SavedSignature;
  return (
    !!v &&
    typeof v.id === "string" &&
    typeof v.url === "string" &&
    v.url.startsWith("data:image/png;base64,") &&
    typeof v.width === "number" &&
    typeof v.height === "number"
  );
};

/** Reads remembered signatures, ignoring anything that does not look right. */
export const parseSaved = (text: string | null): SavedSignature[] => {
  if (!text) {
    return [];
  }
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value) ? value.filter(isSignature) : [];
  } catch {
    return [];
  }
};

export const loadSaved = (): SavedSignature[] => {
  try {
    return parseSaved(localStorage.getItem(KEY));
  } catch {
    return [];
  }
};

const store = (list: SavedSignature[]) => {
  try {
    if (list.length) {
      localStorage.setItem(KEY, JSON.stringify(list));
    } else {
      localStorage.removeItem(KEY);
    }
    return true;
  } catch {
    return false;
  }
};

/** Remembers a signature; returns false when the browser refuses (e.g. full). */
export const remember = (signature: SavedSignature) =>
  store([signature, ...loadSaved().filter((s) => s.id !== signature.id)].slice(0, 6));

export const forget = (id: string) => store(loadSaved().filter((s) => s.id !== id));

export const forgetAll = () => store([]);
