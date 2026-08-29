/**
 * The workspace nav.
 *
 * Every destination is scoped to a run, because everything this product shows
 * is about one — there is no account-level view to hang "past runs" off yet.
 * The active row is derived from the route rather than declared, so a link and
 * its highlight cannot disagree.
 */

export type NavKey = "audit" | "runs" | "personas" | "settings";

export type NavIcon = "audit" | "runs" | "personas" | "settings";

export interface NavItem {
  key: NavKey;
  label: string;
  icon: NavIcon;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { key: "audit", label: "Readiness audit", icon: "audit" },
  { key: "runs", label: "Past runs", icon: "runs" },
  { key: "personas", label: "Agent personas", icon: "personas" },
  { key: "settings", label: "Settings", icon: "settings" },
];

/**
 * Sections that own a route segment. Everything else — the four screens of the
 * run flow, and an agent's own page — belongs to the audit.
 */
const SECTIONS: Record<string, NavKey> = {
  personas: "personas",
  history: "runs",
  settings: "settings",
};

export function activeNavKey(segment: string | null): NavKey {
  return (segment && SECTIONS[segment]) || "audit";
}

export function navHref(key: NavKey, runId: string): string {
  switch (key) {
    case "audit":
      return `/runs/${runId}/input`;
    case "runs":
      return `/runs/${runId}/history`;
    case "personas":
      return `/runs/${runId}/personas`;
    case "settings":
      return `/runs/${runId}/settings`;
  }
}

/** Segments that are part of the run flow, and so keep the stepper. */
export function isFlowSegment(segment: string | null): boolean {
  return activeNavKey(segment) === "audit";
}
