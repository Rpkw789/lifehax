import { describe, expect, test } from "bun:test";
import { loadExampleCheckResult } from "../fixtures";
import { openFindingsStore } from "../store/findings";
import type { FindingsStore } from "../store/findings";
import { createEvaluateRoutes } from "./evaluate";

function app() {
  return createEvaluateRoutes(openFindingsStore(":memory:"));
}

describe("POST /runs/:id/evaluate", () => {
  test("returns ranked findings for a valid CheckResult", async () => {
    const res = await app().request("/runs/run_1/evaluate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(loadExampleCheckResult()),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.findings.map((f: { finding_id: string }) => f.finding_id)).toEqual([
      "F001", "F002", "F003", "F004", "F005", "F006",
    ]);
  });

  test("rejects a body that is not a valid CheckResult", async () => {
    const res = await app().request("/runs/run_1/evaluate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ report_type: "wrong" }),
    });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("invalid_check_result");
  });

  test("rejects a body that is not JSON", async () => {
    const res = await app().request("/runs/run_1/evaluate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_json");
  });

  test("persists the result so it can be reloaded", async () => {
    const store = openFindingsStore(":memory:");
    const routes = createEvaluateRoutes(store);
    await routes.request("/runs/run_7/evaluate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(loadExampleCheckResult()),
    });
    expect(store.load("run_7")!.length).toBe(6);
  });

  test("returns the standard error shape when persistence fails", async () => {
    const brokenStore: FindingsStore = {
      save() {
        throw new Error("disk unavailable");
      },
      load() {
        return null;
      },
    };
    const res = await createEvaluateRoutes(brokenStore).request("/runs/run_1/evaluate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(loadExampleCheckResult()),
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("persistence_failed");
    expect(body.error.message).toBeTruthy();
  });
});
