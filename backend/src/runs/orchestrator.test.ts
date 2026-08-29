import assert from "node:assert/strict";
import test from "node:test";

import { assertCheckResult } from "../../../shared/contracts/validate.ts";
import { runSimulation, type SimulationDependencies } from "./orchestrator.ts";
import type { AgentEvent, ShopperAgent } from "../agents/types.ts";
import type { JsonGenerationRequest, StructuredModelClient } from "../models/types.ts";
import type { FetchedDocument } from "../catalogue/snapshot.ts";

test("runSimulation passes one valid CheckResult to the result sink", async () => {
  const saved: unknown[] = [];
  const result = await runSimulation(input(), dependencies(saved, successfulAgent()));

  assertCheckResult(result);
  assert.equal(result.agent_runs.length, 2);
  assert.equal(result.scores.hit_rate, 0.5);
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0], result);
});

test("runSimulation records a failed shopper and continues the run", async () => {
  const result = await runSimulation(input(), dependencies([], failingAgent()));

  assert.equal(result.status, "complete");
  assert.equal(result.agent_runs.length, 2);
  assert.deepEqual(result.agent_runs[0]?.outcome.failure_codes, [{ code: "AGENT_ERROR" }]);
  assert.equal(JSON.stringify(result).includes("provider failed"), false);
});

test("runSimulation records shopper timeouts without dropping the population", async () => {
  const deps = dependencies([], timeoutAgent());
  deps.config.agentAttemptTimeoutMs = 5;
  const result = await runSimulation(input(), deps);
  assert.equal(result.agent_runs.length, 2);
  assert.deepEqual(result.agent_runs[0]?.outcome.failure_codes, [{ code: "AGENT_TIMEOUT" }]);
});

function input() {
  return {
    run_id: "run_1",
    report_id: "report_1",
    store_url: "https://shop.example",
    target_product_url: "https://shop.example/items/alpha",
    locale: "en-SG",
    currency: "SGD",
    agent_kind: "shared-search" as const,
    baseline_report_id: null,
  };
}

function dependencies(saved: unknown[], agent: ShopperAgent): SimulationDependencies {
  const personaClient: StructuredModelClient = {
    async generateJson<T>(_request: JsonGenerationRequest): Promise<T> {
      return {
        personas: [
          { name: "One", persona: "First", query: "query one", intent: "novice" },
          { name: "Two", persona: "Second", query: "query two", intent: "comparison" },
        ],
      } as T;
    },
  };
  return {
    config: {
      agentCount: 2,
      agentConcurrency: 2,
      agentAttemptTimeoutMs: 100,
      runBudgetMs: 2_000,
      cloudflareAccountId: "account",
      cloudflareApiToken: "token",
      cloudflareModel: "anthropic/claude-opus-4.8",
      nativeModel: "claude-opus-5",
    },
    personaClient,
    fetcher: {
      async get(url): Promise<FetchedDocument> {
        if (url.endsWith("/items/alpha")) return doc(url, 200, `<script type="application/ld+json">{"@type":"Product","name":"Alpha","url":"https://shop.example/items/alpha","sku":"A-1","offers":{"price":"20","priceCurrency":"SGD","availability":"InStock"}}</script>`);
        if (url.endsWith("/sitemap.xml")) return doc(url, 200, `<urlset><url><loc>https://shop.example/items/alpha</loc></url></urlset>`, "application/xml");
        if (url.endsWith("/robots.txt")) return doc(url, 200, "User-agent: *\nAllow: /", "text/plain");
        return doc(url, 404, "");
      },
    },
    agent,
    validateUrls: async () => undefined,
    now: () => new Date("2026-08-29T00:00:00.000Z"),
    resultSink: { async save(result) { saved.push(result); } },
    eventSink: { async emit() {} },
  };
}

function successfulAgent(): ShopperAgent {
  return {
    kind: "shared-search",
    model: "anthropic/claude-opus-4.8",
    async *run(brief, context): AsyncIterable<AgentEvent> {
      const target = brief.query_id === "q_001";
      yield { type: "agent.query", run_id: context.runId, query_id: brief.query_id, agent_id: `agent_${brief.query_id}`, agent_kind: "shared-search", query: brief.query };
      yield { type: "agent.citation", run_id: context.runId, query_id: brief.query_id, agent_id: `agent_${brief.query_id}`, agent_kind: "shared-search", title: target ? "Alpha" : "Other", url: target ? "https://shop.example/items/alpha" : "https://other.example/item", position: 1 };
      yield { type: "agent.verdict", run_id: context.runId, query_id: brief.query_id, agent_id: `agent_${brief.query_id}`, agent_kind: "shared-search", proposal: { candidates: [{ name: target ? "Alpha" : "Other", url: target ? "https://shop.example/items/alpha" : "https://other.example/item", reason_codes: [] }], purchase_intent: "medium", confidence: 0.7 } };
    },
  };
}

function failingAgent(): ShopperAgent {
  return {
    kind: "shared-search",
    model: "anthropic/claude-opus-4.8",
    async *run(): AsyncIterable<AgentEvent> { throw new Error("provider failed"); },
  };
}

function timeoutAgent(): ShopperAgent {
  return {
    kind: "shared-search",
    model: "anthropic/claude-opus-4.8",
    async *run(_brief, context): AsyncIterable<AgentEvent> {
      await new Promise<void>((resolve) => context.signal.addEventListener("abort", () => resolve(), { once: true }));
    },
  };
}

function doc(url: string, status: number, body: string, contentType = "text/html"): FetchedDocument {
  return { url, status, body, contentType, durationMs: 1 };
}
