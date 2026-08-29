import assert from "node:assert/strict";
import test from "node:test";

import { generatePersonas } from "./generate.ts";
import type { JsonGenerationRequest, StructuredModelClient } from "../models/types.ts";

test("generatePersonas returns validated briefs from one structured model call", async () => {
  const requests: JsonGenerationRequest[] = [];
  const client: StructuredModelClient = {
    async generateJson<T>(request: JsonGenerationRequest): Promise<T> {
      requests.push(request);
      return {
        personas: [
          { name: "Value seeker", persona: "Balances price and fit", query: "Find an option under 30 SGD", intent: "budget_led" },
          { name: "Careful comparer", persona: "Compares stated facts", query: "Compare options with blue color", intent: "comparison" },
        ],
      } as T;
    },
  };

  const personas = await generatePersonas(
    {
      productName: "Alpha",
      category: null,
      price: { amount: 20, currency: "SGD" },
      attributes: { color: "blue" },
      locale: "en-SG",
      count: 2,
    },
    client,
  );

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.model, "claude-opus-5");
  assert.equal(requests[0]?.stream, true);
  assert.equal(personas[0]?.query_id, "q_001");
  assert.equal(personas[1]?.brief_id, "brief_002");
});

test("generatePersonas rejects duplicate generated queries", async () => {
  const client: StructuredModelClient = {
    async generateJson<T>(): Promise<T> {
      return {
        personas: [
          { name: "One", persona: "First", query: "same query", intent: "novice" },
          { name: "Two", persona: "Second", query: "same query", intent: "comparison" },
        ],
      } as T;
    },
  };

  await assert.rejects(
    generatePersonas({ productName: "Alpha", category: null, price: null, attributes: {}, locale: "en-US", count: 2 }, client),
    /queries must be unique/,
  );
});
