import assert from "node:assert/strict";
import test from "node:test";

import { createSimulationDependencies } from "./services.ts";
import { readConfig } from "../env.ts";

const sinks = {
  resultSink: { async save() {} },
  eventSink: { async emit() {} },
};

test("createSimulationDependencies builds the configured shared-search agent", () => {
  const dependencies = createSimulationDependencies(
    { agentKind: "shared-search", personaApiKey: "server-key" },
    readConfig({
      CLOUDFLARE_ACCOUNT_ID: "account",
      CLOUDFLARE_API_TOKEN: "token",
      CLOUDFLARE_GATEWAY_ID: "gateway",
    }),
    "https://shop.example",
    sinks,
  );
  assert.equal(dependencies.agent.kind, "shared-search");
});

test("createSimulationDependencies requires a request-scoped key for native search", () => {
  assert.throws(
    () => createSimulationDependencies(
      { agentKind: "native-search", personaApiKey: "server-key" },
      readConfig({}),
      "https://shop.example",
      sinks,
    ),
    /native search requires a request-scoped Anthropic key/,
  );
});
