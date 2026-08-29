/**
 * Domain shapes for a readiness run.
 *
 * These are deliberately the shapes the production API is specified to
 * produce (see "State Management" in the handoff), not the shapes the
 * prototype happened to use — so a real SSE/websocket stream can replace
 * the fixture clock without touching the components.
 */

/** The six journey stages, in order. Stages are 1-indexed on the wire. */
export type StageName =
  | "discover"
  | "land"
  | "read"
  | "select"
  | "cart"
  | "checkout";

/** 1-indexed stage number, matching `AgentEvent.stage`. */
export type StageNumber = 1 | 2 | 3 | 4 | 5 | 6;

/** A buying brief — the natural-language intent an agent shops with. */
export interface Persona {
  name: string;
  /** Quoted, verbatim from the brief table. */
  prompt: string;
  /** Hex. The only chroma in the product besides the stage ramp. */
  color: string;
  /** Three-letter mono tag, e.g. "BGN". */
  tag: string;
}

/**
 * An edit made on the personas screen. Mirrors `backend/src/types.ts`.
 *
 * Keyed by archetype tag, not index: the backend writes a fresh population for
 * every run and only the tag survives between two of them. A null brief slot
 * keeps whatever the generator wrote for that seat.
 */
export interface PersonaOverride {
  tag: string;
  name?: string;
  /** One slot per seat in the archetype, in order. */
  briefs?: (string | null)[];
}

/**
 * An agent in the population. `fail` is the 1-indexed stage the agent could
 * not enter; 0 means it completed checkout.
 *
 * In production `fail`/`reason` are not known up front — they arrive as a
 * `fail` event. The fixture pre-declares them so the clock can derive the
 * whole run; consumers should read outcomes off `AgentState`, never off here.
 */
export interface AgentPlan {
  id: string;
  /** Index into `PERSONAS`. */
  personaIndex: number;
  fail: 0 | StageNumber;
  reason?: string;
}

/**
 * One observation from the run. This is the wire shape: a real stream emits
 * these and the UI buffers and replays them from a clock.
 */
export interface AgentEvent {
  /** Tick the event landed on. Elapsed seconds = `t * 0.14`. */
  t: number;
  agentId: string;
  /** 1-indexed. */
  stage: StageNumber;
  kind: "pass" | "fail";
  /** Present on `fail`. */
  reason?: string;
}

/** Derived per render from the tick — never stored. */
export interface AgentState {
  id: string;
  persona: Persona;
  personaIndex: number;
  fail: 0 | StageNumber;
  reason?: string;
  /** Highest stage index this agent can reach (`fail - 1`, or 6). */
  ceiling: number;
  /** Tick the agent started on. */
  started: number;
  /** Stages cleared so far, 0–6. */
  progress: number;
  /** The agent has stopped moving, for either reason. */
  settled: boolean;
  /** Settled and completed checkout. */
  ok: boolean;
  /** Settled and blocked. */
  blocked: boolean;
}

export type Severity = "critical" | "high" | "medium";

/** A diagnosed cause, ranked by how many agents the fix unblocks. */
export interface Finding {
  key: string;
  severity: Severity;
  title: string;
  /** Cites specific agent ids — this is what makes the screen credible. */
  evidence: string;
  fix: string;
  /** e.g. "+4 agents" */
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
  /** Persona indices that are switched off for this run. */
  disabledPersonas: number[];
}

/** A surface score, computed by the backend from the site audit. */
export interface Surface {
  name: string;
  /** 0-100, as a string for display. */
  score: string;
  /** 0..1, for the chevron track fill. */
  fraction: number;
  note: string;
}


/** One HTTP probe from the site audit. */
export interface Probe {
  url: string;
  found: boolean;
  status: number | null;
  note: string | null;
}

/** The site audit, as the backend reports it. */
export interface Checks {
  agentCommerce: Probe;
  ucp: Probe;
  llmsTxt: Probe;
  robots: Probe & { allowsAgents: boolean };
  sitemap: Probe & { productsListed: number };
  pages: {
    url: string;
    status: number | null;
    hasProductJsonLd: boolean;
    hasOfferPrice: boolean;
    priceInServedHtml: boolean;
    hasCartForm: boolean;
    quantityMax: number | null;
  }[];
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
