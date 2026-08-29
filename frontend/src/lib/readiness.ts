/**
 * The headline readiness number.
 *
 * The mean of the surface scores, which are themselves arithmetic over the
 * audit probes. No model decides this, and neither does a constant — the
 * screen showed a hardcoded 42 before this existed.
 */

import type { Surface } from "./types";

/** 0-100. Reads `fraction`, since `score` is a display string. */
export function overallScore(surfaces: Surface[]): number {
  if (surfaces.length === 0) return 0;
  const mean = surfaces.reduce((sum, s) => sum + s.fraction, 0) / surfaces.length;
  return Math.round(mean * 100);
}

/** Plain words for a score. Bands are contiguous: every 0-100 value has one. */
export function verdictFor(score: number): string {
  if (score >= 80) return "Agent ready";
  if (score >= 60) return "Mostly reachable";
  if (score >= 40) return "Partially reachable";
  if (score >= 15) return "Barely reachable";
  return "Unreachable";
}
