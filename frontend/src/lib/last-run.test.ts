import { describe, expect, test } from "bun:test";
import {
  LAST_RUN_KEY,
  isRunId,
  readLastRunId,
  writeLastRunId,
} from "./last-run";

/** A stand-in for `window.localStorage` that records what was written. */
function fakeStorage(initial?: string | null) {
  const store = new Map<string, string>();
  if (initial != null) store.set(LAST_RUN_KEY, initial);
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    read: () => store.get(LAST_RUN_KEY) ?? null,
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

describe("isRunId", () => {
  test("accepts the ids the routes actually carry", () => {
    for (const id of ["2049", "a", "run_12", "8f3c-4d1e", "A".repeat(64)]) {
      expect(isRunId(id)).toBe(true);
    }
  });

  test("rejects anything that would not survive a URL path", () => {
    // A stored id is pasted straight into `/runs/${id}/input`, so a value
    // with a slash or a scheme would navigate somewhere else entirely.
    for (const v of [
      "",
      "  ",
      "../../settings",
      "2049/input",
      "https://evil.example",
      "a b",
      "A".repeat(65),
      null,
      undefined,
      2049,
      {},
    ]) {
      expect(isRunId(v)).toBe(false);
    }
  });
});

describe("readLastRunId", () => {
  test("returns the id that was stored", () => {
    expect(readLastRunId(fakeStorage("2049"))).toBe("2049");
  });

  test("returns null when nothing has been stored yet", () => {
    expect(readLastRunId(fakeStorage())).toBe(null);
  });

  test("returns null rather than trusting a garbage value", () => {
    expect(readLastRunId(fakeStorage("../../settings"))).toBe(null);
  });

  test("returns null when storage throws", () => {
    expect(readLastRunId(hostileStorage)).toBe(null);
  });

  test("returns null when there is no storage at all", () => {
    expect(readLastRunId(null)).toBe(null);
  });
});

describe("writeLastRunId", () => {
  test("stores the id", () => {
    const storage = fakeStorage();
    writeLastRunId(storage, "2049");
    expect(storage.read()).toBe("2049");
  });

  test("refuses to store an id it would not read back", () => {
    const storage = fakeStorage();
    writeLastRunId(storage, "2049/input");
    expect(storage.read()).toBe(null);
  });

  test("swallows a storage failure rather than breaking navigation", () => {
    expect(() => writeLastRunId(hostileStorage, "2049")).not.toThrow();
    expect(() => writeLastRunId(null, "2049")).not.toThrow();
  });
});
