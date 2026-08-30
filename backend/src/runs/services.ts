import type { AppConfig } from "../env.ts";
import { CloudflareWebSearchClient } from "../agents/cloudflare.ts";
import { AnthropicNativeSearchClient } from "../agents/native-client.ts";
import { NativeSearchAgent } from "../agents/native-search.ts";
import { SharedSearchAgent } from "../agents/shared-search.ts";
import type { AgentKind } from "../agents/types.ts";
import { OriginFetcher } from "../catalogue/fetch.ts";
import { systemHostLookup } from "../catalogue/security.ts";
import { AnthropicStructuredClient } from "../models/anthropic.ts";
import type { EventSink, ResultSink, SimulationDependencies } from "./orchestrator.ts";

export interface SimulationSecrets {
  agentKind: AgentKind;
  personaApiKey: string;
  nativeAnthropicApiKey?: string;
}

export function createSimulationDependencies(
  secrets: SimulationSecrets,
  config: AppConfig,
  storeUrl: string,
  sinks: { resultSink: ResultSink; eventSink: EventSink },
): SimulationDependencies {
  if (!secrets.personaApiKey.trim()) throw new Error("persona generation requires a server Anthropic key");
  const agent = secrets.agentKind === "shared-search"
    ? sharedAgent(config)
    : nativeAgent(secrets.nativeAnthropicApiKey);

  return {
    config,
    personaClient: new AnthropicStructuredClient({ apiKey: secrets.personaApiKey }),
    fetcher: new OriginFetcher(new URL(storeUrl).origin, systemHostLookup),
    agent,
    resultSink: sinks.resultSink,
    eventSink: sinks.eventSink,
  };
}

function sharedAgent(config: AppConfig): SharedSearchAgent {
  if (!config.cloudflareAccountId || !config.cloudflareApiToken || !config.cloudflareGatewayId) {
    throw new Error("shared search requires Cloudflare account, token and gateway id");
  }
  return new SharedSearchAgent(new CloudflareWebSearchClient({
    accountId: config.cloudflareAccountId,
    gatewayId: config.cloudflareGatewayId,
    apiToken: config.cloudflareApiToken,
  }));
}

function nativeAgent(apiKey: string | undefined): NativeSearchAgent {
  if (!apiKey?.trim()) throw new Error("native search requires a request-scoped Anthropic key");
  return new NativeSearchAgent(new AnthropicNativeSearchClient({ apiKey }));
}
