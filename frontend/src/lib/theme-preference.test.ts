import { describe, expect, test } from "bun:test";
import {
  STORAGE_KEY,
  isThemePreference,
  readPreference,
  resolveTheme,
  writePreference,
  type ThemePreference,
} from "./theme-preference";

/** A stand-in for `window.localStorage` that records what was written. */
function fakeStorage(initial?: string | null) {
  const store = new Map<string, string>();
  if (initial != null) store.set(STORAGE_KEY, initial);
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    read: () => store.get(STORAGE_KEY) ?? null,
  };
}

/** Safari in private mode: reads succeed, writes throw QuotaExceededError. */
const hostileStorage = {
  getItem() {
    throw new Error("SecurityError: access denied");
  },
  setItem() {
    throw new Error("QuotaExceededError");
  },
};

describe("resolveTheme", () => {
  test("an explicit preference ignores the system setting", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("light", false)).toBe("light");
    expect(resolveTheme("dark", true)).toBe("dark");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  test("system follows the OS", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
});

describe("isThemePreference", () => {
  test("accepts the three preferences", () => {
    for (const p of ["system", "light", "dark"] as ThemePreference[]) {
      expect(isThemePreference(p)).toBe(true);
    }
  });

  test("rejects anything else", () => {
    for (const v of ["", "Dark", "auto", null, undefined, 0, {}]) {
      expect(isThemePreference(v)).toBe(false);
    }
  });
});

describe("readPreference", () => {
  test("returns what was stored", () => {
    expect(readPreference(fakeStorage("dark"))).toBe("dark");
    expect(readPreference(fakeStorage("light"))).toBe("light");
  });

  test("defaults to system when nothing is stored", () => {
    expect(readPreference(fakeStorage())).toBe("system");
  });

  test("defaults to system rather than trusting a garbage value", () => {
    expect(readPreference(fakeStorage("neon"))).toBe("system");
  });

  test("defaults to system when storage throws", () => {
    expect(readPreference(hostileStorage)).toBe("system");
  });

  test("defaults to system when there is no storage at all", () => {
    expect(readPreference(null)).toBe("system");
  });
});

describe("writePreference", () => {
  test("stores the preference", () => {
    const storage = fakeStorage();
    writePreference(storage, "dark");
    expect(storage.read()).toBe("dark");
  });

  test("swallows a storage failure rather than breaking the toggle", () => {
    expect(() => writePreference(hostileStorage, "dark")).not.toThrow();
    expect(() => writePreference(null, "dark")).not.toThrow();
  });
});
