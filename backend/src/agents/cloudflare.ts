import type { MessageCreateParams } from "@anthropic-ai/sdk/resources/messages/messages";
import { parseAnthropicProposalContent, parseAnthropicResearch, rankingPrompt, SHOPPER_OUTPUT_SCHEMA, shopperPrompt } from "./proposal.ts";
import type { WebSearchClient, WebSearchRequest, WebSearchResponse } from "./types.ts";

interface CloudflareOptions {
  accountId: string;
  apiToken: string;
  transport?: HttpTransport;
}

type HttpTransport = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class CloudflareWebSearchClient implements WebSearchClient {
  readonly #accountId: string;
  readonly #apiToken: string;
  readonly #transport: HttpTransport;

  constructor(options: CloudflareOptions) {
    this.#accountId = options.accountId;
    this.#apiToken = options.apiToken;
    this.#transport = options.transport ?? fetch;
  }

  async recommend(request: WebSearchRequest): Promise<WebSearchResponse> {
    const started = performance.now();
    const researchContent = await this.#send(
      webSearchMessageParams("anthropic/claude-opus-4.8", request, true),
      request.signal,
    );
    const research = parseAnthropicResearch(researchContent);
    const proposalContent = await this.#send(
      rankingMessageParams("anthropic/claude-opus-4.8", request, research.researchText, research.citations, true),
      request.signal,
    );
    return {
      proposal: parseAnthropicProposalContent(proposalContent),
      citations: research.citations,
      latencyMs: Math.max(0, Math.round(performance.now() - started)),
    };
  }

  async #send(params: MessageCreateParams, signal: AbortSignal): Promise<unknown[]> {
    const response = await this.#transport(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(this.#accountId)}/ai/v1/messages`,
      {
        method: "POST",
        signal,
        headers: { authorization: `Bearer ${this.#apiToken}`, "content-type": "application/json" },
        body: JSON.stringify(params),
      },
    );
    if (!response.ok) throw new Error(`Cloudflare Anthropic request failed with HTTP ${response.status}`);
    return parseSseContent(await response.text());
  }
}

export function webSearchMessageParams(model: string, request: WebSearchRequest, stream: boolean): MessageCreateParams {
  return {
    model,
    max_tokens: 8_000,
    stream,
    thinking: { type: "adaptive" },
    messages: [{ role: "user", content: shopperPrompt(request.query, request.locale, request.currency) }],
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
  };
}

export function rankingMessageParams(
  model: string,
  request: WebSearchRequest,
  researchText: string,
  citations: WebSearchResponse["citations"],
  stream: boolean,
): MessageCreateParams {
  return {
    model,
    max_tokens: 8_000,
    stream,
    thinking: { type: "adaptive" },
    messages: [{ role: "user", content: rankingPrompt(request.query, request.locale, request.currency, researchText, citations) }],
    output_config: { format: { type: "json_schema", schema: SHOPPER_OUTPUT_SCHEMA } },
  };
}

function parseSseContent(body: string): unknown[] {
  const textByIndex = new Map<number, string>();
  const blocks: unknown[] = [];
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    const event: unknown = JSON.parse(data);
    if (!isObject(event)) continue;
    if (event.type === "content_block_start" && isObject(event.content_block)) {
      blocks.push(event.content_block);
    }
    if (event.type === "content_block_delta" && typeof event.index === "number" && isObject(event.delta) && event.delta.type === "text_delta" && typeof event.delta.text === "string") {
      textByIndex.set(event.index, (textByIndex.get(event.index) ?? "") + event.delta.text);
    }
  }
  for (const [index, text] of [...textByIndex.entries()].sort((a, b) => a[0] - b[0])) {
    blocks.push({ type: "text", text, index });
  }
  return blocks;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
