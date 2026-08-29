import assert from "node:assert/strict";
import test from "node:test";

import { NativeSearchAgent } from "./native-search.ts";
import { SharedSearchAgent } from "./shared-search.ts";
import type { WebSearchClient } from "./types.ts";
import type { PersonaBrief } from "../personas/generate.ts";

const brief: PersonaBrief = {
  brief_id: "brief_001",
  query_id: "q_001",
  name: "Value seeker",
  persona: "Balances cost and fit",
  query: "Find an option under 30 SGD",
  intent: "budget_led",
};

const client: WebSearchClient = {
  async recommend() {
    return {
      latencyMs: 12,
      citations: [{ title: "Alpha", url: "https://shop.example/items/alpha" }],
      proposal: {
        candidates: [{ name: "Alpha", url: "https://shop.example/items/alpha", reason_codes: [{ code: "PRICE_MATCH" }] }],
        purchase_intent: "high",
        confidence: 0.9,
      },
    };
  },
};

test("SharedSearchAgent streams query, API, citation, and verdict events", async () => {
  const events = await collect(new SharedSearchAgent(client).run(brief, context()));

  assert.deepEqual(events.map((event) => event.type), ["agent.query", "agent.api", "agent.citation", "agent.verdict"]);
  assert.equal(events.at(-1)?.agent_kind, "shared-search");
});

test("NativeSearchAgent uses the same event contract with a native kind", async () => {
  const events = await collect(new NativeSearchAgent(client).run(brief, context()));
  assert.equal(events.at(-1)?.agent_kind, "native-search");
});

function context() {
  return { runId: "run_1", locale: "en-SG", currency: "SGD", signal: new AbortController().signal };
}

async function collect(iterable: AsyncIterable<unknown>): Promise<Array<Record<string, unknown>>> {
  const values: Array<Record<string, unknown>> = [];
  for await (const value of iterable) values.push(value as Record<string, unknown>);
  return values;
}
