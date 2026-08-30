/**
 * The model transport boundary. Generation goes through Cloudflare AI Gateway's
 * OpenAI-compatible endpoint; the three surface simulations use OpenAI Responses
 * directly. Both paths use plain fetch and keep credentials out of logs.
 *
 * The compat endpoint is why model ids here are `{provider}/{model}` — that
 * prefix is the gateway's own routing convention, not decoration. Anthropic-only
 * request fields (adaptive thinking, server-side tools) cannot be expressed in
 * the OpenAI schema and are not sent; the shopper agents, which need them, go
 * through the Anthropic passthrough instead. See `models/gateway.ts`.
 */

import { logger, since } from "./log";
import {
  compatChatCompletionsUrl,
  gatewayHeaders,
  gatewayTarget,
} from "./models/gateway.ts";

const llmLog = logger("llm");
const DEFAULT_MODEL = "anthropic/claude-sonnet-4-5";

export {
  completeOpenAiJson,
  createOpenAiResponse,
  openAiConfigured,
  openAiOutputText,
} from "./models/openai.ts";
export type { OpenAiResponseOptions } from "./models/openai.ts";

export class LlmError extends Error {}

export type JsonSchema = Record<string, unknown>;
export type LlmTransport = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface CompleteJsonOptions {
  accountId?: string;
  apiToken?: string;
  gatewayId?: string;
  model?: string;
  transport?: LlmTransport;
  signal?: AbortSignal;
}

interface ResolvedOptions {
  accountId: string;
  apiToken: string;
  gatewayId: string;
  model: string;
  transport: LlmTransport;
  signal?: AbortSignal;
}

/** OpenAI chat-completions shape, which is what the compat endpoint returns. */
interface ChatCompletionsResponse {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export function llmConfigured(options: CompleteJsonOptions = {}): boolean {
  const resolved = resolveOptions(options);
  return Boolean(resolved.accountId && resolved.apiToken && resolved.gatewayId);
}

export async function completeJson<T>(
  system: string,
  user: string,
  schema: JsonSchema,
  maxTokens = 8000,
  options: CompleteJsonOptions = {},
): Promise<T> {
  const resolved = resolveOptions(options);
  if (!resolved.accountId || !resolved.apiToken || !resolved.gatewayId) {
    throw new LlmError(
      "CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN and CLOUDFLARE_GATEWAY_ID are not all set — see backend/.env.example",
    );
  }

  const schemaInstruction = [
    system,
    "Return only one JSON value matching this JSON Schema:",
    JSON.stringify(schema),
  ].join("\n\n");
  let prompt = user;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const text = await sendMessage(
      schemaInstruction,
      prompt,
      maxTokens,
      resolved,
    );
    try {
      return parseJsonText(text) as T;
    } catch {
      prompt = [
        user,
        "Your previous response was rejected because it was not valid JSON.",
        "Return only corrected JSON matching the supplied schema.",
        `Rejected response: ${text.slice(0, 2_000)}`,
      ].join("\n\n");
    }
  }

  throw new LlmError("model output was not valid JSON");
}

async function sendMessage(
  system: string,
  user: string,
  maxTokens: number,
  options: ResolvedOptions,
): Promise<string> {
  const startedAt = Date.now();
  llmLog.info("request", { model: options.model, chars: user.length });
  const endpoint = compatChatCompletionsUrl({
    accountId: options.accountId,
    gatewayId: options.gatewayId,
  });
  const response = await options.transport(endpoint, {
    method: "POST",
    signal: options.signal,
    headers: gatewayHeaders(options.apiToken),
    // OpenAI schema: no top-level `system` field, so the system prompt becomes
    // the first message. Adaptive thinking is deliberately absent — it is an
    // Anthropic request field the compat layer has no slot for.
    body: JSON.stringify({
      model: options.model,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    llmLog.error("gateway rejected the request", {
      status: response.status,
      ms: since(startedAt),
    });
    throw new LlmError(`gateway rejected the request with HTTP ${response.status}`);
  }

  let parsed: ChatCompletionsResponse;
  try {
    parsed = JSON.parse(raw) as ChatCompletionsResponse;
  } catch {
    throw new LlmError("gateway returned a malformed response");
  }

  const text = parsed.choices?.[0]?.message?.content;
  if (!text) {
    llmLog.error("no completion returned", { ms: since(startedAt) });
    throw new LlmError("gateway returned no completion");
  }

  llmLog.info("reply", {
    ms: since(startedAt),
    chars: text.length,
    out: parsed.usage?.completion_tokens ?? 0,
  });
  return text;
}

function resolveOptions(options: CompleteJsonOptions): ResolvedOptions {
  const configuredModel =
    options.model ?? process.env.HAPPY2_MODEL ?? DEFAULT_MODEL;
  const target = gatewayTarget();
  return {
    accountId: options.accountId ?? target?.accountId ?? "",
    apiToken: options.apiToken ?? process.env.CLOUDFLARE_API_TOKEN ?? "",
    gatewayId: options.gatewayId ?? target?.gatewayId ?? "",
    // The compat endpoint routes on the `{provider}/` prefix, so a bare model
    // id is not merely unfashionable here — it does not resolve.
    model: configuredModel.includes("/")
      ? configuredModel
      : `anthropic/${configuredModel}`,
    transport: options.transport ?? fetch,
    ...(options.signal ? { signal: options.signal } : {}),
  };
}

function parseJsonText(text: string): unknown {
  const unfenced = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  try {
    return JSON.parse(unfenced) as unknown;
  } catch {
    const objectStart = unfenced.indexOf("{");
    const objectEnd = unfenced.lastIndexOf("}");
    if (objectStart >= 0 && objectEnd > objectStart) {
      return JSON.parse(unfenced.slice(objectStart, objectEnd + 1)) as unknown;
    }
    throw new Error("not JSON");
  }
}
