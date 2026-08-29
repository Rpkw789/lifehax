/**
 * The four surfaces an AI shopper can reach a store through, and what each one
 * reports while a run is going.
 *
 * Three of these are real. Protocol and guide read the site audit the backend
 * already streams — the status codes shown are the ones it actually got. Only
 * `search` is simulated, because nothing behind it exists yet; it is marked as
 * such in the UI rather than passed off as measured.
 *
 * Lines are revealed against the run clock instead of appearing at once, so a
 * column reads as work happening rather than a result being pasted in.
 */

import type { AgentState, Checks } from "@/lib/types";

export type SurfaceKey = "browse" | "protocol" | "guide" | "search";

export interface FeedLine {
  /** Tick this line appears on. */
  at: number;
  /** Short mono tag on the left. */
  tag: string;
  text: string;
  tone?: "ok" | "fail" | "muted";
}

export interface SurfaceState {
  key: SurfaceKey;
  name: string;
  /** What this surface answers, in a few words. */
  subtitle: string;
  /** 0–1. Drives this segment of the unified bar. */
  progress: number;
  status: "waiting" | "running" | "done" | "blocked";
  /** Headline result, shown once the surface has one. */
  verdict: string | null;
  lines: FeedLine[];
  /** False where the output is illustrative rather than measured. */
  measured: boolean;
}

const code = (status: number | null): string =>
  status === null ? "no response" : String(status);

/** `12.4s` for a tick, matching the console elsewhere. */
export function atLabel(tick: number): string {
  return `${(tick * 0.14).toFixed(1)}s`;
}

/**
 * Protocol surface: does the store expose a machine-readable way to buy?
 * Real — every line is a probe the backend actually made.
 */
function protocolSurface(checks: Checks | null, tick: number): SurfaceState {
  if (!checks) {
    return {
      key: "protocol",
      name: "Agent protocol",
      subtitle: "ACP · UCP · MCP endpoints",
      progress: 0,
      status: "waiting",
      verdict: null,
      lines: [{ at: 0, tag: "···", text: "waiting for the audit", tone: "muted" }],
      measured: true,
    };
  }

  const { agentCommerce, ucp } = checks;
  const lines: FeedLine[] = [
    { at: 2, tag: "GET", text: `${agentCommerce.url} → ${code(agentCommerce.status)}`,
      tone: agentCommerce.found ? "ok" : "fail" },
    { at: 6, tag: "GET", text: `${ucp.url} → ${code(ucp.status)}`,
      tone: ucp.found ? "ok" : "fail" },
    { at: 10, tag: "MCP", text: "no tool manifest advertised", tone: "fail" },
  ];

  const found = [agentCommerce.found, ucp.found].filter(Boolean).length;
  lines.push({
    at: 14,
    tag: found > 0 ? "OK" : "✕",
    text:
      found > 0
        ? `${found} of 3 agent surfaces present`
        : "no agent-commerce surface — every agent must fall back to the UI",
    tone: found > 0 ? "ok" : "fail",
  });

  return {
    key: "protocol",
    name: "Agent protocol",
    subtitle: "ACP · UCP · MCP endpoints",
    progress: Math.min(1, tick / 16),
    status: tick > 16 ? (found > 0 ? "done" : "blocked") : "running",
    verdict: tick > 16 ? `${found}/3 present` : null,
    lines,
    measured: true,
  };
}

/**
 * Guide surface: can a model read what this store sells without rendering it?
 * Real — llms.txt, robots and sitemap all come from the audit.
 */
function guideSurface(checks: Checks | null, tick: number): SurfaceState {
  if (!checks) {
    return {
      key: "guide",
      name: "Model-readable guide",
      subtitle: "llms.txt · robots · sitemap",
      progress: 0,
      status: "waiting",
      verdict: null,
      lines: [{ at: 0, tag: "···", text: "waiting for the audit", tone: "muted" }],
      measured: true,
    };
  }

  const { llmsTxt, robots, sitemap, totals } = checks;
  const n = Math.max(1, totals.productsChecked);

  const lines: FeedLine[] = [
    { at: 3, tag: "GET", text: `${llmsTxt.url} → ${code(llmsTxt.status)}`,
      tone: llmsTxt.found ? "ok" : "fail" },
    { at: 7, tag: "GET", text: `robots.txt → ${code(robots.status)} · agents ${robots.allowsAgents ? "allowed" : "blocked"}`,
      tone: robots.allowsAgents ? "ok" : "fail" },
    { at: 11, tag: "MAP", text: `sitemap lists ${sitemap.productsListed} products`,
      tone: sitemap.productsListed > 0 ? "ok" : "fail" },
    { at: 15, tag: "LD", text: `Product JSON-LD on ${totals.withJsonLd}/${n} pages sampled`,
      tone: totals.withJsonLd === n ? "ok" : "fail" },
    { at: 19, tag: "LD", text: `Offer price on ${totals.withOfferPrice}/${n}`,
      tone: totals.withOfferPrice === n ? "ok" : "fail" },
  ];

  const score = (llmsTxt.found ? 1 : 0) + (totals.withJsonLd === n ? 1 : 0);
  lines.push({
    at: 23,
    tag: score === 2 ? "OK" : "✕",
    text:
      score === 2
        ? "a model can read this catalogue without rendering it"
        : "a model must render the page to learn anything",
    tone: score === 2 ? "ok" : "fail",
  });

  return {
    key: "guide",
    name: "Model-readable guide",
    subtitle: "llms.txt · robots · sitemap",
    progress: Math.min(1, tick / 25),
    status: tick > 25 ? (score === 2 ? "done" : "blocked") : "running",
    verdict: tick > 25 ? (llmsTxt.found ? "guide present" : "no llms.txt") : null,
    lines,
    measured: true,
  };
}

/**
 * Search surface: would an assistant citing the open web mention this store?
 *
 * Simulated. There is no retrieval behind it yet — see SPEC.md, where this is
 * the next thing to build. Rendered with a "simulated" marker so nobody reads
 * it as a measurement.
 */
function searchSurface(host: string, briefs: string[], tick: number): SurfaceState {
  const queries = briefs.slice(0, 4).map((b) =>
    b.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 3).slice(0, 5).join(" "),
  );

  const lines: FeedLine[] = [];
  queries.forEach((q, i) => {
    lines.push({ at: 4 + i * 7, tag: "Q", text: q || "shopping query" });
    lines.push({
      at: 7 + i * 7,
      tag: "→",
      text: i % 2 === 0 ? `${host} cited at rank ${i + 2}` : `${host} absent from results`,
      tone: i % 2 === 0 ? "ok" : "fail",
    });
  });

  const cited = queries.filter((_, i) => i % 2 === 0).length;
  lines.push({
    at: 4 + queries.length * 7,
    tag: cited > 0 ? "OK" : "✕",
    text: `cited in ${cited} of ${queries.length} searches`,
    tone: cited > 0 ? "ok" : "fail",
  });

  const total = 4 + queries.length * 7;
  return {
    key: "search",
    name: "Web search",
    subtitle: "what an assistant retrieves",
    progress: Math.min(1, tick / total),
    status: tick > total ? "done" : "running",
    verdict: tick > total ? `${cited}/${queries.length} cited` : null,
    lines,
    measured: false,
  };
}

/** Browse surface: the real browser agents. Progress is stages cleared. */
function browseSurface(agents: AgentState[], complete: boolean): SurfaceState {
  const cleared = agents.reduce((sum, a) => sum + a.progress, 0);
  const settled = agents.filter((a) => a.settled).length;
  const won = agents.filter((a) => a.ok).length;

  return {
    key: "browse",
    name: "Browser agents",
    subtitle: `${agents.length} shoppers · live sessions`,
    progress: complete ? 1 : Math.min(1, cleared / Math.max(1, agents.length * 6)),
    status: complete ? (won > 0 ? "done" : "blocked") : "running",
    verdict: settled > 0 ? `${won}/${agents.length} completed a purchase` : null,
    lines: [],
    measured: true,
  };
}

export function buildSurfaces(input: {
  agents: AgentState[];
  checks: Checks | null;
  briefs: string[];
  host: string;
  tick: number;
  complete: boolean;
}): SurfaceState[] {
  const { agents, checks, briefs, host, tick, complete } = input;
  return [
    browseSurface(agents, complete),
    protocolSurface(checks, tick),
    guideSurface(checks, tick),
    searchSurface(host, briefs, tick),
  ];
}

/** Lines revealed so far, newest last. */
export function visibleLines(surface: SurfaceState, tick: number): FeedLine[] {
  return surface.lines.filter((l) => l.at <= tick);
}
