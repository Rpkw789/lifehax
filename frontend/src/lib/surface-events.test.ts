import { describe, expect, test } from "bun:test";
import type { CheckResult } from "@contracts/check-result";
import type {
  SurfaceSimulationEvent,
  SurfaceSimulationKey,
} from "@contracts/surface-simulation";
import fixture from "@fixtures/check-result.example.json";
import {
  appendSurfaceEvent,
  surfaceConsoleState,
  surfaceEventsFor,
  surfaceJson,
  surfaceTime,
} from "./surface-events";

const report = fixture as CheckResult;

describe("appendSurfaceEvent", () => {
  test("appends real events in sequence and suppresses replay duplicates", () => {
    const earlier = event("surf_earlier", 1, "agent_protocol", "fetch");
    const later = event("surf_later", 2, "agent_protocol", "result");
    const folded = [later, earlier, earlier].reduce(appendSurfaceEvent, []);

    expect(folded.map((item) => item.event_id)).toEqual([
      earlier.event_id,
      later.event_id,
    ]);
  });

  test("keeps each surface transcript isolated", () => {
    const protocol = event("surf_protocol", 1, "agent_protocol", "fetch");
    const search = event("surf_search", 2, "web_search", "fetch");

    expect(surfaceEventsFor("web_search", [protocol, search])).toEqual([
      search,
    ]);
    expect(surfaceEventsFor("agent_protocol", [protocol, search])).toEqual([
      protocol,
    ]);
  });
});

describe("surface console derivation", () => {
  test("formats event time relative to the first transcript event", () => {
    expect(
      surfaceTime(
        "2026-08-29T10:25:04.614Z",
        "2026-08-29T10:25:03.114Z",
      ),
    ).toBe("1.5s");
  });

  test("moves from waiting to running to settled using real phases", () => {
    expect(surfaceConsoleState("agent_protocol", [], null).status).toBe(
      "waiting",
    );
    expect(
      surfaceConsoleState(
        "agent_protocol",
        [event("surf_fetch", 1, "agent_protocol", "fetch")],
        null,
      ).status,
    ).toBe("running");
    expect(
      surfaceConsoleState(
        "agent_protocol",
        [
          event(
            "surf_result",
            2,
            "agent_protocol",
            "result",
            "Simulation settled: ACP/UCP unavailable",
          ),
        ],
        report,
      ),
    ).toMatchObject({
      status: "blocked",
      progress: 1,
      verdict: "Simulation settled: ACP/UCP unavailable",
    });
  });

  test("extracts only the relevant contract-valid JSON for each panel", () => {
    expect(surfaceJson("agent_protocol", report)).toEqual({
      agent_commerce: report.site_audit.agent_commerce,
      ucp: report.site_audit.ucp,
    });
    expect(surfaceJson("model_readable_guide", report)).toEqual({
      llms_txt: report.site_audit.llms_txt,
    });
    expect(surfaceJson("web_search", report)).toEqual({
      agent_run: report.agent_runs[0] ?? null,
      score: report.scores.by_query[0] ?? null,
    });
  });
});

function event(
  event_id: string,
  sequence: number,
  surface: SurfaceSimulationKey,
  phase: SurfaceSimulationEvent["phase"],
  message = `Event ${sequence}`,
): SurfaceSimulationEvent {
  return {
    event_id,
    sequence,
    surface,
    phase,
    at: new Date(Date.parse("2026-08-29T10:25:03.114Z") + sequence * 100).toISOString(),
    message,
    evidence_id: null,
  };
}
