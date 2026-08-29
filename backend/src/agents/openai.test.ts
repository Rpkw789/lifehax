import { expect, test } from "bun:test";

import { OpenAIWebSearchClient } from "./openai.ts";

test("OpenAI web search separates sourced research from structured ranking", async () => {
  const requestBodies: Array<Record<string, unknown>> = [];
  const fetched: string[] = [];
  const client = new OpenAIWebSearchClient({
    apiKey: "openai-secret",
    model: "gpt-5-mini",
    transport: async (_url, init) => {
      requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json(
        requestBodies.length === 1 ? searchResponse() : rankingResponse(),
      );
    },
  });

  const result = await client.recommend({
    query: "Find a well-documented option",
    locale: "en-SG",
    currency: "SGD",
    storeOrigin: "https://shop.example",
    fetchPage: async (url) => {
      fetched.push(url);
      return { url, status: 200, body: "Price: 20 SGD" };
    },
    signal: new AbortController().signal,
  });

  expect(requestBodies).toHaveLength(2);
  expect((requestBodies[0]?.tools as Array<{ type: string }>)[0]?.type).toBe(
    "web_search",
  );
  expect(requestBodies[0]?.include).toEqual([
    "web_search_call.action.sources",
  ]);
  expect(requestBodies[0]?.reasoning).toEqual({ effort: "low" });
  expect(requestBodies[0]?.input).not.toContain("shop.example");
  expect(requestBodies[1]?.tools).toBeUndefined();
  expect(
    (requestBodies[1]?.text as { format: { type: string } }).format.type,
  ).toBe("json_schema");
  expect(requestBodies[1]?.reasoning).toEqual({ effort: "low" });
  expect(JSON.stringify(requestBodies[1])).toContain("Price: 20 SGD");
  expect(result.citations.slice(0, 2)).toEqual([
    { title: "Alpha", url: "https://shop.example/items/alpha" },
    { title: "Independent result", url: "https://reviews.example/alpha" },
  ]);
  expect(result.citations).toHaveLength(10);
  expect(fetched).toEqual(["https://shop.example/items/alpha"]);
  expect(result.fetchedPages).toEqual([
    { url: "https://shop.example/items/alpha", status: 200 },
  ]);
  expect(result.proposal.candidates[0]?.name).toBe("Alpha");
});

test("OpenAI web search retries one transient Responses API failure", async () => {
  let calls = 0;
  const client = new OpenAIWebSearchClient({
    apiKey: "openai-secret",
    model: "gpt-5-mini",
    transport: async () => {
      calls += 1;
      if (calls === 1) return new Response("busy", { status: 503 });
      return Response.json(calls === 2 ? searchResponse() : rankingResponse());
    },
  });

  await client.recommend({
    query: "Find an option",
    locale: "en-SG",
    currency: "SGD",
    storeOrigin: "https://shop.example",
    fetchPage: async (url) => ({ url, status: 200, body: "Price: 20 SGD" }),
    signal: new AbortController().signal,
  });

  expect(calls).toBe(3);
});

function searchResponse() {
  return {
    id: "resp_search",
    status: "completed",
    output: [
      {
        type: "web_search_call",
        status: "completed",
        action: {
          type: "search",
          queries: ["well documented option"],
          sources: [
            { type: "url", url: "https://shop.example/items/alpha" },
            { type: "url", url: "https://reviews.example/alpha" },
            ...Array.from({ length: 12 }, (_, index) => ({
              type: "url",
              url: `https://source${index + 1}.example/item`,
            })),
          ],
        },
      },
      {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: "Alpha is documented by the store and an independent review.",
            annotations: [
              {
                type: "url_citation",
                title: "Alpha",
                url: "https://shop.example/items/alpha",
              },
              {
                type: "url_citation",
                title: "Independent result",
                url: "https://reviews.example/alpha",
              },
            ],
          },
        ],
      },
    ],
  };
}

function rankingResponse() {
  return {
    id: "resp_rank",
    status: "completed",
    output: [
      {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: JSON.stringify({
              candidates: [
                {
                  name: "Alpha",
                  url: "https://shop.example/items/alpha",
                  reason_codes: [
                    { code: "PRICE_MATCH", attribute: null, note: null },
                  ],
                },
              ],
              purchase_intent: "high",
              confidence: 0.8,
            }),
            annotations: [],
          },
        ],
      },
    ],
  };
}
