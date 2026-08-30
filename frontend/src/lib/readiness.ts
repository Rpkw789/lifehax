/**
 * The headline number, and the surface mean underneath it.
 *
 * Two different measurements live here and they must not be confused. The
 * headline is a *bot-defence* reading taken from the browser agents: every one
 * that walks a full journey to checkout, unchallenged, is a bot the storefront
 * failed to stop. The surface scores are the fetch audit — what a crawler can
 * parse — and they stay exactly what they were.
 *
 * Neither involves a model. `exposureScore` counts settled agents; the surface
 * scores are arithmetic over the audit probes.
 */

import type { AgentState, Surface } from "./types";

/** 0-100. Reads `fraction`, since `score` is a display string. */
export function overallScore(surfaces: Surface[]): number {
  if (surfaces.length === 0) return 0;
  const mean = surfaces.reduce((sum, s) => sum + s.fraction, 0) / surfaces.length;
  return Math.round(mean * 100);
}

/**
 * How well the storefront resisted the agent population, 0-100.
 *
 * Inverted on purpose: an agent reaching checkout is not a success, it is an
 * automated purchase nothing on the site interrupted. All ten through means 0.
 *
 * Counts only agents that have settled, so the number does not swing wildly
 * while the run is still moving — a mid-run agent has neither got through nor
 * been stopped, and treating it as either invents a result.
 */
export function exposureScore(agents: AgentState[]): number {
  const settled = agents.filter((a) => a.settled);
  if (settled.length === 0) return 100;
  const through = settled.filter((a) => a.ok).length;
  return Math.round((1 - through / settled.length) * 100);
}

/** Plain words for a defence score. Bands are contiguous: every 0-100 has one. */
export function exposureVerdictFor(score: number): string {
  if (score >= 80) return "Hardened";
  if (score >= 60) return "Mostly holding";
  if (score >= 40) return "Porous";
  if (score >= 15) return "Weak";
  return "Wide open";
}

/**
 * Plain words for a surface score.
 *
 * Still framed as readability, because that is what the fetch audit measures —
 * whether a machine can parse the store. Read it alongside the defence score,
 * not as a substitute: a site can be perfectly parseable and still stop bots at
 * the cart, and those are two different facts about it.
 */
export function verdictFor(score: number): string {
  if (score >= 80) return "Fully machine-readable";
  if (score >= 60) return "Mostly readable";
  if (score >= 40) return "Partially readable";
  if (score >= 15) return "Barely readable";
  return "Unreadable";
}
