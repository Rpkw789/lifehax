import type { PersonaBrief } from "../personas/generate.ts";
import type { AgentEvent, AgentKind, RunContext, ShopperAgent, WebSearchClient } from "./types.ts";

export abstract class BaseSearchAgent implements ShopperAgent {
  abstract readonly kind: AgentKind;
  abstract readonly model: string;
  protected abstract readonly endpoint: string;
  readonly #client: WebSearchClient;

  constructor(client: WebSearchClient) {
    this.#client = client;
  }

  async *run(brief: PersonaBrief, context: RunContext): AsyncIterable<AgentEvent> {
    const base = {
      run_id: context.runId,
      query_id: brief.query_id,
      agent_id: `agent_${brief.query_id.slice(2)}`,
      agent_kind: this.kind,
    } as const;
    yield { ...base, type: "agent.query", query: brief.query };
    const response = await this.#client.recommend({
      query: brief.query,
      locale: context.locale,
      currency: context.currency,
      signal: context.signal,
    });
    yield { ...base, type: "agent.api", endpoint: this.endpoint, latency_ms: response.latencyMs };
    for (const [index, citation] of response.citations.entries()) {
      yield { ...base, type: "agent.citation", ...citation, position: index + 1 };
    }
    yield { ...base, type: "agent.verdict", proposal: response.proposal };
  }
}
