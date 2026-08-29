import Anthropic from "@anthropic-ai/sdk";
import type { MessageCreateParams } from "@anthropic-ai/sdk/resources/messages/messages";
import { messageParams } from "./cloudflare.ts";
import { parseAnthropicContent } from "./proposal.ts";
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
    const message = await this.#streamMessage(messageParams("claude-opus-5", request, true), request.signal);
    if (!isObject(message)) throw new Error("Anthropic returned an invalid message");
    const parsed = parseAnthropicContent(message.content);
    return { ...parsed, latencyMs: Math.max(0, Math.round(performance.now() - started)) };
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
