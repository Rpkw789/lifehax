import assert from "node:assert/strict";
import test from "node:test";

import { readConfig } from "./env.ts";

test("readConfig applies the approved simulation limits", () => {
  const config = readConfig({
    CLOUDFLARE_ACCOUNT_ID: "account",
    CLOUDFLARE_API_TOKEN: "token",
  });

  assert.equal(config.agentCount, 20);
  assert.equal(config.agentConcurrency, 4);
  assert.equal(config.agentAttemptTimeoutMs, 45_000);
  assert.equal(config.runBudgetMs, 300_000);
  assert.equal(config.cloudflareModel, "anthropic/claude-opus-4.8");
  assert.equal(config.nativeModel, "claude-opus-5");
});

test("readConfig rejects an invalid numeric limit", () => {
  assert.throws(
    () => readConfig({ AGENT_COUNT: "zero" }),
    /AGENT_COUNT must be a positive integer/,
  );
});
