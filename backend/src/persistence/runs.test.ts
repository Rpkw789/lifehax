import { beforeEach, describe, expect, test } from "bun:test";
import { openDb } from "./db";
import { openRunsStore } from "./runs";
import type { RunsStore } from "./runs";
import { createRun } from "../store";
import type { Run } from "../types";

// Set TEST_DATABASE_URL to run this same suite against a real Postgres. Unset,
// it runs on in-memory SQLite, which is what CI and a fresh checkout do.
const db = openDb(process.env.TEST_DATABASE_URL, ":memory:");

function aRun(storeUrl: string, overrides: Partial<Run> = {}): Run {
  return {
    ...createRun({
      storeUrl,
      feedUrl: "",
      agentEndpoint: "",
      sitemapUrl: "",
      testSkus: "",
      disabledPersonas: [],
      locale: "en-US",
      currency: "USD",
    }),
    ...overrides,
  };
}

describe(`runs store (${db.engine})`, () => {
  let store: RunsStore;

  beforeEach(async () => {
    store = await openRunsStore(db);
    await db.exec("DELETE FROM runs");
  });

  test("round-trips a whole run", async () => {
    const run = aRun("https://shop.example", { status: "complete" });
    await store.save(run);
    expect(await store.load(run.runId)).toEqual({ ...run, sessions: {}, sessionsClosed: true });
  });

  test("returns null for a run it has never seen", async () => {
    expect(await store.load("nope")).toBeNull();
  });

  test("lists summaries newest first, without the document", async () => {
    await store.save(aRun("https://old.example", { createdAt: "2026-01-01T00:00:00.000Z" }));
    await store.save(aRun("https://new.example", { createdAt: "2026-06-01T00:00:00.000Z" }));

    const listed = await store.list();
    expect(listed.map((r) => r.storeUrl)).toEqual([
      "https://new.example",
      "https://old.example",
    ]);
    expect(listed[0]).not.toHaveProperty("document");
  });

  test("counts findings and blocked agents into the summary", async () => {
    const run = aRun("https://shop.example", {
      status: "complete",
      findings: [{ key: "f1" }, { key: "f2" }] as Run["findings"],
      events: [
        { t: 1, agentId: "a1", stage: 3, kind: "fail" },
        { t: 2, agentId: "a2", stage: 4, kind: "pass" },
        { t: 3, agentId: "a3", stage: 6, kind: "fail" },
      ],
    });
    await store.save(run);

    const [summary] = await store.list();
    expect(summary).toMatchObject({ status: "complete", findings: 2, blocked: 2 });
  });

  test("re-saving the same run updates it rather than adding a row", async () => {
    const run = aRun("https://shop.example");
    await store.save(run);
    await store.save({ ...run, status: "complete" });

    const listed = await store.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]!.status).toBe("complete");
  });

  test("drops live sessions, which are dead by the time a run is reloaded", async () => {
    const run = aRun("https://shop.example", {
      sessions: { a1: { sessionId: "s1", liveViewUrl: "https://live.example/s1" } },
      sessionsClosed: false,
    });
    await store.save(run);

    const loaded = await store.load(run.runId);
    expect(loaded!.sessions).toEqual({});
    expect(loaded!.sessionsClosed).toBe(true);
  });

  test("honours the list limit", async () => {
    for (const n of [1, 2, 3]) {
      await store.save(aRun(`https://shop${n}.example`, { createdAt: `2026-0${n}-01T00:00:00.000Z` }));
    }
    expect(await store.list(2)).toHaveLength(2);
  });
});
