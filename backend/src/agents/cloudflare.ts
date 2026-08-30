import type { MessageCreateParams } from "@anthropic-ai/sdk/resources/messages/messages";
import { anthropicMessagesUrl, gatewayHeaders } from "../models/gateway.ts";
import { fetchCitedStorePages, parseAnthropicProposalContent, parseAnthropicResearch, rankingPrompt, SHOPPER_OUTPUT_SCHEMA, shopperPrompt } from "./proposal.ts";
import type { WebSearchClient, WebSearchRequest, WebSearchResponse } from "./types.ts";

/**
 * These calls take the gateway's Anthropic passthrough, not `/compat`.
 *
 * `web_search` is an Anthropic server-side tool and `thinking` is an Anthropic
 * request field; neither survives translation to the OpenAI schema, and the
 * search results are the measurement. `parseSseContent` below reads Anthropic
 * stream events for the same reason. Plain generation uses compat — `llm.ts`.
 */
interface CloudflareOptions {
  accountId: string;
  gatewayId: string;
  apiToken: string;
  transport?: HttpTransport;
}

type HttpTransport = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class CloudflareWebSearchClient implements WebSearchClient {
  readonly #endpoint: string;
  readonly #apiToken: string;
  readonly #transport: HttpTransport;

  constructor(options: CloudflareOptions) {
    this.#endpoint = anthropicMessagesUrl({
      accountId: options.accountId,
      gatewayId: options.gatewayId,
    });
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
    const fetchedPages = await fetchCitedStorePages(research.citations, request);
    const proposalContent = await this.#send(
      rankingMessageParams("anthropic/claude-opus-4.8", request, research.researchText, research.citations, fetchedPages, true),
      request.signal,
    );
    return {
      proposal: parseAnthropicProposalContent(proposalContent),
      citations: research.citations,
      fetchedPages: fetchedPages.map(({ url, status }) => ({ url, status })),
      latencyMs: Math.max(0, Math.round(performance.now() - started)),
    };
  }

  async #send(params: MessageCreateParams, signal: AbortSignal): Promise<unknown[]> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let response: Response;
      try {
        response = await this.#transport(this.#endpoint, {
          method: "POST",
          signal,
          // `anthropic-version` is required by the passthrough. The provider key
          // slot stays empty: Unified Billing supplies it at the gateway.
          headers: { ...gatewayHeaders(this.#apiToken), "anthropic-version": "2023-06-01" },
          body: JSON.stringify(params),
        });
      } catch (error) {
        if (attempt === 0 && !signal.aborted) continue;
        throw error;
      }
      if (!response.ok) {
        if (attempt === 0 && transientStatus(response.status)) continue;
        throw new Error(`Cloudflare Anthropic request failed with HTTP ${response.status}`);
      }
      try {
        return parseSseContent(await response.text());
      } catch (error) {
        if (attempt === 0 && !signal.aborted) continue;
        throw error;
      }
    }
    throw new Error("Cloudflare Anthropic request failed");
  }
}

function transientStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
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
  fetchedPages: Parameters<typeof rankingPrompt>[5],
  stream: boolean,
): MessageCreateParams {
  return {
    model,
    max_tokens: 8_000,
    stream,
    thinking: { type: "adaptive" },
    messages: [{ role: "user", content: rankingPrompt(request.query, request.locale, request.currency, researchText, citations, fetchedPages) }],
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
