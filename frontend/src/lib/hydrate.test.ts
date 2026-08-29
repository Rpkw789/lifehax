import { describe, expect, test } from "bun:test";

import { hydrate, type SavedRun } from "./hydrate";
import type {
  AgentEvent,
  Checks,
  Finding,
  Persona,
  Probe,
  Surface,
} from "./types";

const persona: Persona = {
  name: "Budget Led",
  prompt: "the cheapest option that ships free",
  color: "#c98a12",
  tag: "BGN",
};

const event: AgentEvent = {
  t: 4,
  agentId: "A01",
  stage: 3,
  kind: "fail",
  reason: "no agent-commerce surface",
};

const finding: Finding = {
  key: "F001",
  severity: "high",
  title: "No llms.txt",
  evidence: "A01, A04 and A07 fell back to the UI",
  fix: "Publish /llms.txt",
  impact: "+3 agents",
  surface: "Model-readable guide",
  effort: "an hour",
  owner: "Web",
  snippetLabel: "llms.txt",
  snippet: "# Bose",
};

const surface: Surface = {
  name: "Agent protocol",
  score: "0",
  fraction: 0,
  note: "0/3 present",
};

function probe(url: string): Probe {
  return { url, found: false, status: 404, note: null };
}

const checks: Checks = {
  agentCommerce: probe("https://bose.com/.well-known/agent-commerce"),
  ucp: probe("https://bose.com/.well-known/ucp"),
  llmsTxt: probe("https://bose.com/llms.txt"),
  robots: { ...probe("https://bose.com/robots.txt"), allowsAgents: true },
  sitemap: { ...probe("https://bose.com/sitemap.xml"), productsListed: 207 },
  pages: [],
  totals: {
    productsChecked: 4,
    withJsonLd: 4,
    withOfferPrice: 4,
    priceInServedHtml: 0,
    withCartForm: 0,
    quantityCapped: 0,
  },
  checkoutWall: { ...probe("https://bose.com/cart"), requiresAccount: true },
};

/** A saved run as `GET /runs/:id` returns it. */
function saved(over: Partial<SavedRun> = {}): SavedRun {
  return {
    runId: "r1",
    status: "complete",
    error: null,
    createdAt: "2026-08-29T14:24:15.263Z",
    startedAtMs: 1788013455263,
    input: {
      storeUrl: "https://bose.com",
      feedUrl: "",
      agentEndpoint: "",
      sitemapUrl: "",
      testSkus: "",
      disabledPersonas: [2],
    },
    catalogue: { products: [{ url: "a" }, { url: "b" }, { url: "c" }] },
    personas: [persona],
    briefs: ["brief one", "brief two"],
    checks,
    surfaces: [surface],
    findings: [finding],
    events: [event],
    sessions: {},
    ...over,
  } as SavedRun;
}

describe("hydrate", () => {
  test("carries the run's own record onto the screens", () => {
    const state = hydrate(saved());
    expect(state.events).toEqual([event]);
    expect(state.personas).toEqual([persona]);
    expect(state.briefs).toEqual(["brief one", "brief two"]);
    expect(state.findings).toEqual([finding]);
    expect(state.surfaces).toEqual([surface]);
    expect(state.checks).toEqual(checks);
  });

  test("counts the catalogue, which is stored as products not a total", () => {
    expect(hydrate(saved()).catalogueCount).toBe(3);
  });

  test("a run that never built a catalogue counts zero, not NaN", () => {
    expect(hydrate(saved({ catalogue: null })).catalogueCount).toBe(0);
  });

  test("seeds the input so the header names the store it audited", () => {
    expect(hydrate(saved()).input.storeUrl).toBe("https://bose.com");
    expect(hydrate(saved()).input.disabledPersonas).toEqual([2]);
  });

  test("supplies locale and currency that saved runs predate", () => {
    // Runs saved before those fields existed must not hydrate them undefined.
    const state = hydrate(saved());
    expect(state.input.locale).toBe("en-US");
    expect(state.input.currency).toBe("USD");
  });

  test("a finished run reads as complete and not running", () => {
    const state = hydrate(saved());
    expect(state.complete).toBe(true);
    expect(state.running).toBe(false);
  });

  test("a run still in flight reads as running", () => {
    const state = hydrate(saved({ status: "running" }));
    expect(state.running).toBe(true);
    expect(state.complete).toBe(false);
  });

  test("a failed run carries its error and is not left running", () => {
    const state = hydrate(saved({ status: "error", error: "no such host" }));
    expect(state.error).toBe("no such host");
    expect(state.running).toBe(false);
    expect(state.complete).toBe(true);
  });

  test("surface simulations default empty — runs saved before them have none", () => {
    const state = hydrate(saved({ surfaceEvents: undefined, checkResult: undefined }));
    expect(state.surfaceEvents).toEqual([]);
    expect(state.checkResult).toBeNull();
  });

  test("drops live sessions, whose URLs are dead once the run ends", () => {
    const state = hydrate(
      saved({ sessions: { A01: { sessionId: "s1", liveViewUrl: "https://live" } } }),
    );
    expect(state.sessions).toEqual({});
  });
});
