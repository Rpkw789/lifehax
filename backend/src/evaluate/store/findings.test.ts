import { describe, expect, test } from "bun:test";
import { loadExampleFindings } from "../../fixtures";
import { openFindingsStore } from "./findings";

describe("findings store", () => {
  test("round-trips findings for a run", () => {
    const store = openFindingsStore(":memory:");
    const findings = loadExampleFindings();
    store.save("run_1", findings);
    expect(store.load("run_1")).toEqual(findings);
  });

  test("returns null for a run it has never seen", () => {
    expect(openFindingsStore(":memory:").load("nope")).toBeNull();
  });

  test("overwrites on re-evaluation rather than appending", () => {
    const store = openFindingsStore(":memory:");
    store.save("run_1", loadExampleFindings());
    store.save("run_1", loadExampleFindings().slice(0, 2));
    expect(store.load("run_1")!.length).toBe(2);
  });
});
