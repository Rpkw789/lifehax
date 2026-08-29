import { describe, expect, test } from "bun:test";
import { validateSurfaceSimulationEvent } from "@contracts/surface-simulation";

describe("validateSurfaceSimulationEvent", () => {
  test("accepts a real append-only progress event", () => {
    expect(
      validateSurfaceSimulationEvent({
        event_id: "surf_guide_0001",
        sequence: 1,
        surface: "model_readable_guide",
        phase: "fetch",
        at: "2026-08-29T10:25:03.114Z",
        message: "GET https://example.com/llms.txt returned HTTP 200",
        evidence_id: "ev_guide_fetch",
      }),
    ).toEqual([]);
  });

  test("rejects unknown surfaces, phases, and malformed ordering fields", () => {
    const errors = validateSurfaceSimulationEvent({
      event_id: "",
      sequence: -1,
      surface: "browser",
      phase: "thinking",
      at: "not-a-date",
      message: "",
      evidence_id: "",
    });

    expect(errors).toContain("event_id must be non-empty");
    expect(errors).toContain("sequence must be a non-negative integer");
    expect(errors).toContain("surface is not supported");
    expect(errors).toContain("phase is not supported");
    expect(errors).toContain("at must be an ISO timestamp");
    expect(errors).toContain("message must be non-empty");
    expect(errors).toContain("evidence_id must be null or a non-empty string");
  });

  test("rejects non-object values without throwing", () => {
    expect(validateSurfaceSimulationEvent(null)).toEqual([
      "event must be an object",
    ]);
  });
});
