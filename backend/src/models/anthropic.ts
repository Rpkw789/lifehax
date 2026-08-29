import Anthropic from "@anthropic-ai/sdk";
import type { MessageCreateParams } from "@anthropic-ai/sdk/resources/messages/messages";
import type { JsonGenerationRequest, StructuredModelClient } from "./types.ts";

type StreamMessage = (params: MessageCreateParams, signal: AbortSignal | undefined) => Promise<unknown>;

interface AnthropicStructuredOptions {
  apiKey: string;
  streamMessage?: StreamMessage;
}

export class AnthropicStructuredClient implements StructuredModelClient {
  readonly #streamMessage: StreamMessage;

  constructor(options: AnthropicStructuredOptions) {
    if (options.streamMessage) {
      this.#streamMessage = options.streamMessage;
    } else {
      const client = new Anthropic({ apiKey: options.apiKey });
      this.#streamMessage = async (params, signal) =>
        client.messages.stream(params, signal ? { signal } : undefined).finalMessage();
    }
  }

  async generateJson<T>(request: JsonGenerationRequest): Promise<T> {
    if (!request.stream) throw new Error("structured model calls must stream");
    const params: MessageCreateParams = {
      model: request.model,
      max_tokens: request.maxTokens,
      stream: true,
      thinking: request.thinking,
      messages: [{ role: "user", content: request.prompt }],
      output_config: { format: { type: "json_schema", schema: request.schema } },
    };
    const message = await this.#streamMessage(params, request.signal);
    if (!isObject(message) || !Array.isArray(message.content)) {
      throw new Error("Anthropic returned an invalid structured message");
    }
    const text = message.content
      .filter((block): block is Record<string, unknown> => isObject(block) && block.type === "text")
      .map((block) => block.text)
      .filter((value): value is string => typeof value === "string")
      .join("");
    if (!text) throw new Error("Anthropic returned no structured text output");
    return JSON.parse(text) as T;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
