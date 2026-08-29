/**
 * Surface scores as a shape.
 *
 * Five numbers read one at a time make you assemble the profile yourself. A
 * radar shows it: strong everywhere except agent protocol is a pentagon with
 * one dent, and the dent is the thing to fix.
 */

import type { Surface } from "./types";

export interface RadarPoint {
  /** Short label for the axis, which has little room. */
  surface: string;
  /** 0-100. */
  score: number;
  /** The full name, for the tooltip. */
  full: string;
}

/** Axis labels are cramped, so drop any parenthetical or slashed qualifier. */
function shortLabel(name: string): string {
  return name.split(/\s+[(/]/)[0]!.trim();
}

export function radarPoints(surfaces: Surface[]): RadarPoint[] {
  return surfaces.map((s) => ({
    surface: shortLabel(s.name),
    score: Math.round(Math.max(0, Math.min(1, s.fraction)) * 100),
    full: s.name,
  }));
}

/**
 * The lowest surface — the dent worth naming under the chart. Null when
 * nothing is below full, because then there is no weakest one to point at.
 */
export function weakestSurface(surfaces: Surface[]): Surface | null {
  let worst: Surface | null = null;
  for (const s of surfaces) {
    if (s.fraction >= 1) continue;
    // Strictly less keeps the first of equals, so the caption is stable.
    if (worst === null || s.fraction < worst.fraction) worst = s;
  }
  return worst;
}
