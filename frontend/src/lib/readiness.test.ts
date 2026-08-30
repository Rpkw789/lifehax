import { describe, expect, test } from "bun:test";
import { exposureScore, exposureVerdictFor, overallScore, verdictFor } from "./readiness";
import type { AgentState, Surface } from "./types";

function surface(score: number): Surface {
  return { name: "s", score: String(score), fraction: score / 100, note: "" };
}

describe("overallScore", () => {
  test("is the mean of the surface scores", () => {
    expect(overallScore([surface(60), surface(30), surface(0), surface(50)])).toBe(35);
  });

  test("rounds to a whole number", () => {
    expect(overallScore([surface(61), surface(30), surface(0), surface(55)])).toBe(37);
  });

  test("is 0 rather than NaN when a run has no surfaces", () => {
    expect(overallScore([])).toBe(0);
  });

  test("reads the fraction, not the display string", () => {
    // `score` is for display and may be formatted; `fraction` is the number.
    const odd: Surface = { name: "s", score: "not a number", fraction: 0.5, note: "" };
    expect(overallScore([odd])).toBe(50);
  });
});

function state(id: string, settled: boolean, ok: boolean): AgentState {
  return {
    id,
    persona: { name: "p", prompt: "", color: "#000", tag: "TAG" },
    personaIndex: 0,
    fail: ok ? 0 : 3,
    started: 0,
    progress: ok ? 6 : 2,
    settled,
    ok,
    blocked: settled && !ok,
  } as AgentState;
}

describe("exposureScore", () => {
  test("is 0 when every settled agent walked to checkout", () => {
    expect(exposureScore([state("A01", true, true), state("A02", true, true)])).toBe(0);
  });

  test("is 100 when the store stopped all of them", () => {
    expect(exposureScore([state("A01", true, false), state("A02", true, false)])).toBe(100);
  });

  test("ignores agents still in flight, which have neither got through nor been stopped", () => {
    // One through, one stopped, one moving: 50, not 33.
    expect(
      exposureScore([
        state("A01", true, true),
        state("A02", true, false),
        state("A03", false, false),
      ]),
    ).toBe(50);
  });

  test("is 100 rather than NaN before anything has settled", () => {
    expect(exposureScore([])).toBe(100);
  });
});

describe("exposureVerdictFor", () => {
  test("names each band", () => {
    expect(exposureVerdictFor(0)).toBe("Wide open");
    expect(exposureVerdictFor(20)).toBe("Weak");
    expect(exposureVerdictFor(45)).toBe("Porous");
    expect(exposureVerdictFor(70)).toBe("Mostly holding");
    expect(exposureVerdictFor(90)).toBe("Hardened");
  });

  test("has no gap between bands", () => {
    for (let i = 0; i <= 100; i++) {
      expect(exposureVerdictFor(i).length).toBeGreaterThan(0);
    }
  });
});

describe("verdictFor", () => {
  test("names each band", () => {
    expect(verdictFor(0)).toBe("Unreadable");
    expect(verdictFor(20)).toBe("Barely readable");
    expect(verdictFor(45)).toBe("Partially readable");
    expect(verdictFor(70)).toBe("Mostly readable");
    expect(verdictFor(90)).toBe("Fully machine-readable");
  });

  test("has no gap between bands", () => {
    for (let i = 0; i <= 100; i++) expect(verdictFor(i).length).toBeGreaterThan(0);
  });
});
