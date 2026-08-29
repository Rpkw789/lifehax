import assert from "node:assert/strict";
import test from "node:test";

import { AnthropicNativeSearchClient } from "./native-client.ts";

test("AnthropicNativeSearchClient separates cited search from structured ranking", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const client = new AnthropicNativeSearchClient({
    apiKey: "brand-key",
    streamMessage: async (params) => {
      requests.push(params as unknown as Record<string, unknown>);
      if (requests.length === 1) return { content: [
        { type: "web_search_tool_result", content: [{ type: "web_search_result", title: "Alpha", url: "https://shop.example/items/alpha", encrypted_content: "opaque" }] },
        { type: "text", text: "Alpha is a possible option." },
      ] };
      return { content: [
        { type: "text", text: JSON.stringify({ candidates: [{ name: "Alpha", url: "https://shop.example/items/alpha", reason_codes: [] }], purchase_intent: "medium", confidence: 0.7 }) },
      ] };
    },
  });

  const result = await client.recommend({ query: "Find an option", locale: "en-SG", currency: "SGD", signal: new AbortController().signal });

  assert.equal(requests.length, 2);
  assert.equal("output_config" in (requests[0] ?? {}), false);
  assert.equal("tools" in (requests[1] ?? {}), false);
  assert.equal(result.citations[0]?.url, "https://shop.example/items/alpha");
  assert.equal(result.proposal.purchase_intent, "medium");
});
