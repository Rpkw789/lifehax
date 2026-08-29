/**
 * Wire contract. These shapes are copied from `frontend/src/lib/types.ts` and
 * must stay identical to it — the frontend renders them directly.
 *
 * Note this is the six-stage browser model the built frontend implements, not
 * the search-based `AgentEvent` union in `docs/data-contracts.md`. See the plan
 * for why they diverge.
 */

import type { CheckResult } from "@contracts/check-result";
import type { SurfaceSimulationEvent } from "@contracts/surface-simulation";

/** The six journey stages, in order. Stages are 1-indexed on the wire. */
export type StageName =
  | "discover"
  | "land"
  | "read"
  | "select"
  | "cart"
  | "checkout";

export const STAGES: readonly StageName[] = [
  "discover",
  "land",
  "read",
  "select",
  "cart",
  "checkout",
] as const;

export type StageNumber = 1 | 2 | 3 | 4 | 5 | 6;

/** A buying brief — the natural-language intent an agent shops with. */
export interface Persona {
  name: string;
  prompt: string;
  /** Hex. */
  color: string;
  /** Three-letter mono tag, e.g. "BGN". */
  tag: string;
}

/**
 * An edit made on the personas screen, applied over what the generator wrote.
 *
 * Keyed by archetype tag rather than by index: the generator writes a fresh
 * population every run, and only the tag is stable across two of them. A null
 * or absent brief slot means "keep whatever was generated for that seat", so a
 * shopper whose brief was never touched still gets a brief written from this
 * store's own catalogue.
 */
export interface PersonaOverride {
  /** Archetype tag, e.g. "BGN". */
  tag: string;
  /** Replacement persona name. Absent leaves the generated one. */
  name?: string;
  /** One slot per seat in the archetype, in order. Null keeps the generated brief. */
  briefs?: (string | null)[];
}

/** One observation from the run. */
export interface AgentEvent {
  /** Tick the event landed on. Elapsed seconds = `t * 0.14`. */
  t: number;
  agentId: string;
  stage: StageNumber;
  kind: "pass" | "fail";
  reason?: string;
}

export type Severity = "critical" | "high" | "medium";

/** A diagnosed cause, ranked by how many agents the fix unblocks. */
export interface Finding {
  key: string;
  severity: Severity;
  title: string;
  /** Cites specific agent ids and observed facts. */
  evidence: string;
  fix: string;
  impact: string;
  surface: string;
  effort: string;
  owner: string;
  snippetLabel: string;
  snippet: string;
}

/** The input payload a run is created from (`POST /runs`). */
export interface RunInput {
  storeUrl: string;
  feedUrl: string;
  agentEndpoint: string;
  sitemapUrl: string;
  testSkus: string;
  disabledPersonas: number[];
  locale: string;
  currency: string;
}

// ---------------------------------------------------------------------------
// Backend-only shapes. Not rendered directly; summarised into the above.
// ---------------------------------------------------------------------------

export interface CatalogueProduct {
  url: string;
  title: string | null;
  price: string | null;
  attributes: Record<string, string>;
}

export interface Catalogue {
  domain: string;
  origin: string;
  /** Where agents start. The store URL as typed, path and all. */
  entryUrl: string;
  /** The user pointed at a specific page rather than the store root. */
  hasPath: boolean;
  products: CatalogueProduct[];
  /**
   * How the product list was obtained, for the audit's discoverability check.
   * `blocked` means the store answered a bot wall rather than a catalogue, which
   * is a different diagnosis from `none` and deserves a different fix.
   */
  source: "products.json" | "sitemap" | "homepage" | "none" | "blocked";
  /** The status the wall answered with, when `source` is `blocked`. */
  blockedStatus?: number | null;
  sitemapProductCount: number;
  /** Product-looking URLs observed in the submitted/default sitemap. */
  sitemapUrls: string[];
  /** True only when every sitemap document needed for membership was read. */
  sitemapComplete: boolean;
}

/** One HTTP probe. A missing resource is a finding, not an error. */
export interface Probe {
  url: string;
  found: boolean;
  status: number | null;
  note: string | null;
}

export interface Checks {
  agentCommerce: Probe;
  ucp: Probe;
  llmsTxt: Probe;
  robots: Probe & { allowsAgents: boolean };
  sitemap: Probe & { productsListed: number };
  /** Per-product page analysis. */
  pages: PageCheck[];
  /** Aggregates over `pages`, so the model does not have to count. */
  totals: {
    productsChecked: number;
    withJsonLd: number;
    withOfferPrice: number;
    priceInServedHtml: number;
    withCartForm: number;
    quantityCapped: number;
  };
  checkoutWall: Probe & { requiresAccount: boolean };
}

export interface PageCheck {
  url: string;
  status: number | null;
  hasJsonLd: boolean;
  hasProductJsonLd: boolean;
  hasOfferPrice: boolean;
  /** The price string appears in the served HTML (not injected client-side). */
  priceInServedHtml: boolean;
  hasCartForm: boolean;
  /** e.g. 10 when `<input name="qty" max="10">`. */
  quantityMax: number | null;
  note: string | null;
}

export interface Surface {
  name: string;
  score: string;
  fraction: number;
  note: string;
}

export type RunStatus = "running" | "complete" | "error";

export interface Run {
  runId: string;
  status: RunStatus;
  error: string | null;
  createdAt: string;
  startedAtMs: number;
  input: RunInput;
  catalogue: Catalogue | null;
  personas: Persona[];
  /**
   * One brief per agent. Two agents share an archetype but never a brief —
   * running the same shopper twice makes half the population redundant.
   */
  briefs: string[];
  checks: Checks | null;
  surfaces: Surface[];
  findings: Finding[];
  events: AgentEvent[];
  surfaceEvents: SurfaceSimulationEvent[];
  checkResult: CheckResult | null;
  /**
   * Live sessions for the agents that really browsed. The embeddable URL is
   * only valid while the session runs — Browserbase returns 410 once it stops.
   */
  sessions: Record<string, { sessionId: string; liveViewUrl: string | null }>;
  /**
   * Set once the browsers are closed. A live view URL outlives its session and
   * renders Browserbase's "debugging connection was closed" page, so consumers
   * must stop showing them at this point rather than waiting for the run to end.
   */
  sessionsClosed: boolean;
}
