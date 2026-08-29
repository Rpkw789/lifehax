import { describe, expect, test } from "bun:test";
import type { SurfaceSimulationEvent } from "@contracts/surface-simulation";
import type { ShopperAgent } from "../agents/types.ts";
import { TimeoutError } from "../runs/retry.ts";
import { runWebSearchSimulation } from "./search.ts";

const target = {
  product_id: "item_primary",
  name: "Primary item",
  canonical_url: "https://example.com/items/primary",
  gtin: null,
  sku: null,
  category: null,
  price: { amount: 20, currency: "USD" },
};

const brief = {
  brief_id: "brief_surface_001",
  query_id: "q_surface_001",
  name: "Careful shopper",
  persona: "Compares credible sources before choosing.",
  query: "Find a well-documented option that arrives this week",
  intent: "product_discovery" as const,
};

describe("runWebSearchSimulation", () => {
  test("uses citations and fetched pages to derive target rank deterministically", async () => {
    const surfaceEvents: SurfaceSimulationEvent[] = [];
    const agent: ShopperAgent = {
      kind: "shared-search",
      model: "anthropic/test-model",
      async *run(persona, context) {
        const citedTarget = "https://www.example.com/items/primary/";
        const base = {
          run_id: context.runId,
          query_id: persona.query_id,
          agent_id: "agent_surface_001",
          agent_kind: "shared-search" as const,
        };
        yield { ...base, type: "agent.query", query: persona.query };
        yield { ...base, type: "agent.api", endpoint: "messages", latency_ms: 12 };
        yield { ...base, type: "agent.citation", title: "Option A", url: "https://first.example/a", position: 1 };
        yield { ...base, type: "agent.citation", title: "Option B", url: "https://second.example/b", position: 2 };
        yield { ...base, type: "agent.citation", title: "Primary item", url: citedTarget, position: 3 };
        yield { ...base, type: "agent.fetch", url: citedTarget, status: 200, error_code: null };
        yield {
          ...base,
          type: "agent.verdict",
          proposal: {
            candidates: [
              { name: "Option A", url: "https://first.example/a", reason_codes: [] },
              { name: "Option B", url: "https://second.example/b", reason_codes: [] },
              { name: target.name, url: citedTarget, reason_codes: [] },
            ],
            purchase_intent: "medium",
            confidence: 0.8,
          },
        };
      },
    };

    const result = await runWebSearchSimulation({
      context: workerContext(),
      brief,
      agent,
      emit: emitter(surfaceEvents),
      critiqueClient: async () => ({
        summary: "Search found the target, but two alternatives ranked first.",
        strengths: [],
        gaps: [],
        shopper_impact: [],
        improvements: [],
      }),
    });

    expect(result.run.query_id).toBe("q_surface_001");
    expect(result.run.outcome.target_discovered).toBe(true);
    expect(result.run.outcome.target_rank).toBe(3);
    expect(result.run.outcome.target_recommended).toBe(true);
    expect(result.critique?.summary).toContain("two alternatives ranked first");
    expect(surfaceEvents.some((event) => event.phase === "match")).toBe(true);
    expect(surfaceEvents.find((event) => event.phase === "match")?.evidence_id).not.toBeNull();
    expect(surfaceEvents.at(-1)?.phase).toBe("result");
  });

  test.each([
    [new Error("network failed"), "AGENT_ERROR"],
    [new TimeoutError("shopper"), "AGENT_TIMEOUT"],
  ] as const)("records %s as %s without recommending the target", async (failure, code) => {
    const agent: ShopperAgent = {
      kind: "shared-search",
      model: "anthropic/test-model",
      async *run() {
        throw failure;
      },
    };

    const result = await runWebSearchSimulation({
      context: workerContext(),
      brief,
      agent,
      emit: emitter([]),
    });

    expect(result.run.outcome.target_recommended).toBe(false);
    expect(result.run.outcome.failure_codes).toEqual([{ code }]);
  });
});

function workerContext() {
  return {
    runId: "run_surface",
    storeUrl: "https://example.com",
    target,
    brief: brief.query,
    locale: "en-SG",
    currency: "SGD",
    at: "2026-08-29T10:25:03.114Z",
    fetcher: {
      async get(url: string) {
        return { url, status: 200, body: "Readable page", contentType: "text/html", durationMs: 1 };
      },
    },
  };
}

function emitter(events: SurfaceSimulationEvent[]) {
  return ((surface, phase, message, evidenceId) => {
    const event: SurfaceSimulationEvent = {
      event_id: `surf_${String(events.length + 1).padStart(4, "0")}`,
      sequence: events.length,
      surface,
      phase,
      at: "2026-08-29T10:25:03.114Z",
      message,
      evidence_id: evidenceId,
    };
    events.push(event);
    return event;
  }) satisfies Parameters<typeof runWebSearchSimulation>[0]["emit"];
}
