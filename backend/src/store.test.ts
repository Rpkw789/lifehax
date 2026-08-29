import { describe, expect, test } from "bun:test";
import type { SurfaceSimulationEvent } from "@contracts/surface-simulation";
import { loadExampleCheckResult } from "./fixtures.ts";
import { createRun, publish } from "./store.ts";

describe("surface simulation run storage", () => {
  test("stores ordered surface events and the final report for replay", () => {
    const run = createRun(inputFixture());
    const later = event("surf_0002", 2, "web_search");
    const earlier = event("surf_0001", 1, "agent_protocol");
    const report = loadExampleCheckResult();

    publish(run, { type: "surface_simulation", event: later });
    publish(run, { type: "surface_simulation", event: earlier });
    publish(run, { type: "surface_simulation", event: earlier });
    publish(run, { type: "check_result", result: report });

    expect(run.surfaceEvents).toEqual([earlier, later]);
    expect(run.checkResult).toBe(report);
  });
});

export function inputFixture() {
  return {
    storeUrl: "https://example.com",
    feedUrl: "",
    agentEndpoint: "",
    sitemapUrl: "",
    testSkus: "",
    disabledPersonas: [],
    locale: "en-US",
    currency: "USD",
  };
}

export function event(
  event_id: string,
  sequence: number,
  surface: SurfaceSimulationEvent["surface"],
): SurfaceSimulationEvent {
  return {
    event_id,
    sequence,
    surface,
    phase: sequence === 2 ? "result" : "fetch",
    at: "2026-08-29T10:25:03.114Z",
    message: `Event ${sequence}`,
    evidence_id: null,
  };
}
