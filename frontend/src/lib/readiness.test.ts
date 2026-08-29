import { describe, expect, test } from "bun:test";
import { overallScore, verdictFor } from "./readiness";
import type { Surface } from "./types";

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

describe("verdictFor", () => {
  test("names each band", () => {
    expect(verdictFor(0)).toBe("Unreachable");
    expect(verdictFor(20)).toBe("Barely reachable");
    expect(verdictFor(45)).toBe("Partially reachable");
    expect(verdictFor(70)).toBe("Mostly reachable");
    expect(verdictFor(90)).toBe("Agent ready");
  });

  test("has no gap between bands", () => {
    for (let i = 0; i <= 100; i++) expect(verdictFor(i).length).toBeGreaterThan(0);
  });
});
