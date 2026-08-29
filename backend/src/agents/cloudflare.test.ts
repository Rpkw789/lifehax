import assert from "node:assert/strict";
import test from "node:test";

import { CloudflareWebSearchClient } from "./cloudflare.ts";

test("CloudflareWebSearchClient separates cited search from structured ranking", async () => {
  let requestUrl = "";
  const requestBodies: Array<Record<string, unknown>> = [];
  const client = new CloudflareWebSearchClient({
    accountId: "account",
    apiToken: "secret-token",
    transport: async (url, init) => {
      requestUrl = String(url);
      requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(requestBodies.length === 1 ? searchSseMessage() : rankingSseMessage(), { status: 200, headers: { "content-type": "text/event-stream" } });
    },
  });

  const result = await client.recommend({ query: "Find an option", locale: "en-SG", currency: "SGD", signal: new AbortController().signal });

  assert.equal(requestUrl, "https://api.cloudflare.com/client/v4/accounts/account/ai/v1/messages");
  assert.equal(requestBodies.length, 2);
  assert.equal(requestBodies[0]?.stream, true);
  assert.equal((requestBodies[0]?.tools as Array<{ type: string }>)[0]?.type, "web_search_20250305");
  assert.equal("output_config" in (requestBodies[0] ?? {}), false);
  assert.equal("tools" in (requestBodies[1] ?? {}), false);
  assert.equal((requestBodies[1]?.output_config as { format: { type: string } }).format.type, "json_schema");
  assert.equal(result.citations[0]?.url, "https://shop.example/items/alpha");
  assert.equal(result.proposal.candidates[0]?.name, "Alpha");
});

function searchSseMessage(): string {
  const result = JSON.stringify({
    type: "content_block_start",
    index: 0,
    content_block: { type: "web_search_tool_result", content: [{ type: "web_search_result", title: "Alpha", url: "https://shop.example/items/alpha" }] },
  });
  const text = JSON.stringify({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Alpha is a possible option." } });
  return `data: ${result}\n\ndata: ${text}\n\ndata: {"type":"message_stop"}\n\n`;
}

function rankingSseMessage(): string {
  const json = JSON.stringify({
    type: "content_block_delta",
    index: 0,
    delta: {
      type: "text_delta",
      text: JSON.stringify({
        candidates: [{ name: "Alpha", url: "https://shop.example/items/alpha", reason_codes: [{ code: "PRICE_MATCH", attribute: null, note: null }] }],
        purchase_intent: "high",
        confidence: 0.8,
      }),
    },
  });
  return `event: content_block_delta\ndata: ${json}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n`;
}
