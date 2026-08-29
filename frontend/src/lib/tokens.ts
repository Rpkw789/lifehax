/**
 * Design tokens. Mirrors the "Design Tokens" section of the handoff README.
 * Neutrals are also exposed as CSS custom properties in globals.css; this
 * module exists for the places that must compute a color in JS (chevron
 * fills, brief-colored borders, the stage ramp).
 */

export const ink = {
  /** #101012 — ink / primary fill */
  ink: "#101012",
  /** #2c2c31 — primary hover */
  inkHover: "#2c2c31",
  /** #3f3f47 — secondary text */
  secondary: "#3f3f47",
  /** #6b6b73 — tertiary text */
  tertiary: "#6b6b73",
  /** #8a8a92 — blocked-track fill */
  blocked: "#8a8a92",
  /** #9a9aa2 — muted mono */
  muted: "#9a9aa2",
  /** #b4b4ba — faint labels */
  faint: "#b4b4ba",
  /** #c9c9cf — "was" chevrons */
  was: "#c9c9cf",
  /** #d3d3d8 — strong border */
  borderStrong: "#d3d3d8",
  /** #e3e3e6 — border */
  border: "#e3e3e6",
  /** #e6e6e9 — unfilled chevron */
  chevronOff: "#e6e6e9",
  /** #ececee — divider */
  divider: "#ececee",
  /** #f2f2f3 — hairline */
  hairline: "#f2f2f3",
  /** #fafafa — header strip */
  strip: "#fafafa",
  /** #fbfbfc — code / console ground */
  ground: "#fbfbfc",
  /** #fcfcfd — sidebar / soft card */
  soft: "#fcfcfd",
  /** #fdfdfe — stepper row */
  stepperRow: "#fdfdfe",
  /** #ffffff — page */
  page: "#ffffff",
} as const;

/**
 * Stage ramp: `oklch(0.70 0.175 H)` where `H = 88 − 62 × i/(count − 1)`.
 * Amber (88) on the left through red (26) on the right.
 */
export function ramp(i: number, count: number): string {
  const h = count <= 1 ? 88 : 88 - 62 * (i / (count - 1));
  return `oklch(0.70 0.175 ${h})`;
}
