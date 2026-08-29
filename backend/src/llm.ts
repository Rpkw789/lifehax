/**
 * The model transport boundary. Existing generation uses Cloudflare's account
 * Messages endpoint; the three surface simulations use OpenAI Responses
 * directly. Both paths use plain fetch and keep credentials out of logs.
 */

import { logger, since } from "./log";

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
  model?: string;
  transport?: LlmTransport;
  signal?: AbortSignal;
}

interface ResolvedOptions {
  accountId: string;
  apiToken: string;
  model: string;
  transport: LlmTransport;
  signal?: AbortSignal;
}

interface MessagesResponse {
  content?: { type: string; text?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

export function llmConfigured(options: CompleteJsonOptions = {}): boolean {
  const resolved = resolveOptions(options);
  return Boolean(resolved.accountId && resolved.apiToken);
}

export async function completeJson<T>(
  system: string,
  user: string,
  schema: JsonSchema,
  maxTokens = 8000,
  options: CompleteJsonOptions = {},
): Promise<T> {
  const resolved = resolveOptions(options);
  if (!resolved.accountId || !resolved.apiToken) {
    throw new LlmError(
      "CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are not set — see backend/.env.example",
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
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(options.accountId)}/ai/v1/messages`;
  const response = await options.transport(endpoint, {
    method: "POST",
    signal: options.signal,
    headers: {
      authorization: `Bearer ${options.apiToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: options.model,
      max_tokens: maxTokens,
      ...(supportsAdaptiveThinking(options.model)
        ? { thinking: { type: "adaptive" } }
        : {}),
      system,
      messages: [{ role: "user", content: user }],
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

  let parsed: MessagesResponse;
  try {
    parsed = JSON.parse(raw) as MessagesResponse;
  } catch {
    throw new LlmError("gateway returned a malformed response");
  }

  const text = parsed.content?.find((block) => block.type === "text")?.text;
  if (!text) {
    llmLog.error("no completion returned", { ms: since(startedAt) });
    throw new LlmError("gateway returned no completion");
  }

  llmLog.info("reply", {
    ms: since(startedAt),
    chars: text.length,
    out: parsed.usage?.output_tokens ?? 0,
  });
  return text;
}

function resolveOptions(options: CompleteJsonOptions): ResolvedOptions {
  const configuredModel =
    options.model ?? process.env.HAPPY2_MODEL ?? DEFAULT_MODEL;
  return {
    accountId: options.accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
    apiToken: options.apiToken ?? process.env.CLOUDFLARE_API_TOKEN ?? "",
    model: configuredModel.includes("/")
      ? configuredModel
      : `anthropic/${configuredModel}`,
    transport: options.transport ?? fetch,
    ...(options.signal ? { signal: options.signal } : {}),
  };
}

function supportsAdaptiveThinking(model: string): boolean {
  const bareModel = model.replace(/^anthropic\//, "");
  return /^claude-(opus|sonnet|fable|mythos)-5|^claude-opus-4-[678]|^claude-sonnet-4-6/.test(
    bareModel,
  );
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
