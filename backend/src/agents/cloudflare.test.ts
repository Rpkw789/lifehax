import assert from "node:assert/strict";
import test from "node:test";

import { CloudflareWebSearchClient } from "./cloudflare.ts";

test("CloudflareWebSearchClient sends a streamed structured web-search request", async () => {
  let requestUrl = "";
  let requestBody = "";
  const client = new CloudflareWebSearchClient({
    accountId: "account",
    apiToken: "secret-token",
    transport: async (url, init) => {
      requestUrl = String(url);
      requestBody = String(init?.body);
      return new Response(sseMessage(), { status: 200, headers: { "content-type": "text/event-stream" } });
    },
  });

  const result = await client.recommend({ query: "Find an option", locale: "en-SG", currency: "SGD", signal: new AbortController().signal });

  assert.equal(requestUrl, "https://api.cloudflare.com/client/v4/accounts/account/ai/v1/messages");
  assert.equal(JSON.parse(requestBody).stream, true);
  assert.equal(JSON.parse(requestBody).tools[0].type, "web_search_20250305");
  assert.equal(result.proposal.candidates[0]?.name, "Alpha");
});

function sseMessage(): string {
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
