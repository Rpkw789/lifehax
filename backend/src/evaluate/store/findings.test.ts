import { describe, expect, test } from "bun:test";
import { loadExampleFindings } from "../../fixtures";
import { openDb } from "../../persistence/db";
import { openFindingsStore } from "./findings";

describe("findings store", () => {
  test("round-trips findings for a run", async () => {
    const store = await openFindingsStore(openDb(undefined, ":memory:"));
    const findings = loadExampleFindings();
    await store.save("run_1", findings);
    expect(await store.load("run_1")).toEqual(findings);
  });

  test("returns null for a run it has never seen", async () => {
    const store = await openFindingsStore(openDb(undefined, ":memory:"));
    expect(await store.load("nope")).toBeNull();
  });

  test("overwrites on re-evaluation rather than appending", async () => {
    const store = await openFindingsStore(openDb(undefined, ":memory:"));
    await store.save("run_1", loadExampleFindings());
    await store.save("run_1", loadExampleFindings().slice(0, 2));
    expect((await store.load("run_1"))!.length).toBe(2);
  });
});
