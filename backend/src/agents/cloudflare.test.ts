import assert from "node:assert/strict";
import test from "node:test";

import { CloudflareWebSearchClient } from "./cloudflare.ts";

test("CloudflareWebSearchClient separates cited search from structured ranking", async () => {
  let requestUrl = "";
  let requestHeaders = new Headers();
  const requestBodies: Array<Record<string, unknown>> = [];
  const fetched: string[] = [];
  const client = new CloudflareWebSearchClient({
    accountId: "account",
    gatewayId: "gw",
    apiToken: "secret-token",
    transport: async (url, init) => {
      requestUrl = String(url);
      requestHeaders = new Headers(init?.headers);
      requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(requestBodies.length === 1 ? searchSseMessage() : rankingSseMessage(), { status: 200, headers: { "content-type": "text/event-stream" } });
    },
  });

  const result = await client.recommend({
    query: "Find an option",
    locale: "en-SG",
    currency: "SGD",
    storeOrigin: "https://shop.example",
    fetchPage: async (url) => {
      fetched.push(url);
      return { url, status: 200, body: "Price: 20 SGD" };
    },
    signal: new AbortController().signal,
  });

  assert.equal(requestUrl, "https://gateway.ai.cloudflare.com/v1/account/gw/anthropic/v1/messages");
  // The gateway reads cf-aig-authorization; a token on `authorization` is read
  // as the provider credential and rejected with a bare 401.
  assert.equal(requestHeaders.get("cf-aig-authorization"), "Bearer secret-token");
  assert.equal(requestHeaders.get("authorization"), null);
  assert.equal(requestHeaders.get("anthropic-version"), "2023-06-01");
  assert.equal(requestBodies.length, 2);
  assert.equal(requestBodies[0]?.stream, true);
  assert.equal((requestBodies[0]?.tools as Array<{ type: string }>)[0]?.type, "web_search_20250305");
  assert.equal("output_config" in (requestBodies[0] ?? {}), false);
  assert.equal("tools" in (requestBodies[1] ?? {}), false);
  assert.equal((requestBodies[1]?.output_config as { format: { type: string } }).format.type, "json_schema");
  assert.equal(result.citations[0]?.url, "https://shop.example/items/alpha");
  assert.deepEqual(fetched, ["https://shop.example/items/alpha"]);
  assert.deepEqual(result.fetchedPages, [{ url: "https://shop.example/items/alpha", status: 200 }]);
  assert.match(JSON.stringify(requestBodies[1]), /Price: 20 SGD/);
  assert.equal(result.proposal.candidates[0]?.name, "Alpha");
});

test("CloudflareWebSearchClient retries one transient gateway response", async () => {
  let calls = 0;
  const client = new CloudflareWebSearchClient({
    accountId: "account",
    gatewayId: "gw",
    apiToken: "secret-token",
    transport: async () => {
      calls += 1;
      if (calls === 1) return new Response("busy", { status: 503 });
      return new Response(calls === 2 ? searchSseMessage() : rankingSseMessage(), { status: 200 });
    },
  });

  await client.recommend(request());
  assert.equal(calls, 3);
});

test("CloudflareWebSearchClient does not retry a permanent client error", async () => {
  let calls = 0;
  const client = new CloudflareWebSearchClient({
    accountId: "account",
    gatewayId: "gw",
    apiToken: "secret-token",
    transport: async () => {
      calls += 1;
      return new Response("invalid", { status: 400 });
    },
  });

  await assert.rejects(client.recommend(request()), /HTTP 400/);
  assert.equal(calls, 1);
});

function request() {
  return {
    query: "Find an option",
    locale: "en-SG",
    currency: "SGD",
    storeOrigin: "https://shop.example",
    fetchPage: async (url: string) => ({ url, status: 200, body: "Price: 20 SGD" }),
    signal: new AbortController().signal,
  };
}

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
