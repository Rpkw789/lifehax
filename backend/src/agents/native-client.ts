import Anthropic from "@anthropic-ai/sdk";
import type { MessageCreateParams } from "@anthropic-ai/sdk/resources/messages/messages";
import { rankingMessageParams, webSearchMessageParams } from "./cloudflare.ts";
import { parseAnthropicProposalContent, parseAnthropicResearch } from "./proposal.ts";
import type { WebSearchClient, WebSearchRequest, WebSearchResponse } from "./types.ts";

export type StreamMessage = (params: MessageCreateParams, signal: AbortSignal) => Promise<unknown>;

interface NativeClientOptions {
  apiKey: string;
  streamMessage?: StreamMessage;
}

export class AnthropicNativeSearchClient implements WebSearchClient {
  readonly #streamMessage: StreamMessage;

  constructor(options: NativeClientOptions) {
    if (options.streamMessage) {
      this.#streamMessage = options.streamMessage;
    } else {
      const client = new Anthropic({ apiKey: options.apiKey });
      this.#streamMessage = async (params, signal) =>
        client.messages.stream(params, { signal }).finalMessage();
    }
  }

  async recommend(request: WebSearchRequest): Promise<WebSearchResponse> {
    const started = performance.now();
    const researchMessage = await this.#streamMessage(webSearchMessageParams("claude-opus-5", request, true), request.signal);
    if (!isObject(researchMessage)) throw new Error("Anthropic returned an invalid search message");
    const research = parseAnthropicResearch(researchMessage.content);
    const proposalMessage = await this.#streamMessage(
      rankingMessageParams("claude-opus-5", request, research.researchText, research.citations, true),
      request.signal,
    );
    if (!isObject(proposalMessage)) throw new Error("Anthropic returned an invalid ranking message");
    return {
      proposal: parseAnthropicProposalContent(proposalMessage.content),
      citations: research.citations,
      latencyMs: Math.max(0, Math.round(performance.now() - started)),
    };
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
