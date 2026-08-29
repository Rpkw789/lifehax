import assert from "node:assert/strict";
import test from "node:test";

import { OriginFetcher } from "./fetch.ts";

const publicLookup = async () => ["203.0.113.10"];

test("OriginFetcher sends an identifying user agent and returns response facts", async () => {
  let receivedAgent = "";
  const fetcher = new OriginFetcher("https://shop.example", publicLookup, async (_url, init) => {
    receivedAgent = new Headers(init?.headers).get("user-agent") ?? "";
    return new Response("hello", { status: 200, headers: { "content-type": "text/html" } });
  });

  const document = await fetcher.get("https://shop.example/items/alpha");

  assert.equal(receivedAgent, "Happy2Agent/1.0 (+https://happy2.example/agent)");
  assert.equal(document.status, 200);
  assert.equal(document.body, "hello");
});

test("OriginFetcher rejects a redirect away from the submitted origin", async () => {
  const fetcher = new OriginFetcher(
    "https://shop.example",
    publicLookup,
    async () => new Response(null, { status: 302, headers: { location: "https://other.example/path" } }),
  );

  await assert.rejects(fetcher.get("https://shop.example/items/alpha"), /redirect left the submitted origin/);
});

test("OriginFetcher spaces outbound requests using its per-origin limiter", async () => {
  let clock = 0;
  const sleeps: number[] = [];
  const fetcher = new OriginFetcher(
    "https://shop.example",
    publicLookup,
    async () => new Response("ok"),
    {
      minIntervalMs: 100,
      now: () => clock,
      sleep: async (ms) => { sleeps.push(ms); clock += ms; },
    },
  );

  await fetcher.get("https://shop.example/one");
  await fetcher.get("https://shop.example/two");

  assert.deepEqual(sleeps, [100]);
});
