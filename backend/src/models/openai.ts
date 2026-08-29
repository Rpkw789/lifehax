import { logger, since } from "../log.ts";
import type { JsonSchema, LlmTransport } from "../llm.ts";

const openAiLog = logger("llm");
const DEFAULT_OPENAI_MODEL = "gpt-5-mini";

export interface OpenAiResponseOptions {
  apiKey?: string;
  model?: string;
  transport?: LlmTransport;
  signal?: AbortSignal;
}

interface OpenAiResponse {
  status?: string;
  output?: unknown[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

class OpenAiError extends Error {}

export function openAiConfigured(options: OpenAiResponseOptions = {}): boolean {
  return Boolean(options.apiKey?.trim() || process.env.OPENAI_API_KEY?.trim());
}

export async function createOpenAiResponse(
  request: Record<string, unknown>,
  options: OpenAiResponseOptions = {},
): Promise<OpenAiResponse> {
  const apiKey = options.apiKey?.trim() || process.env.OPENAI_API_KEY?.trim() || "";
  const model = options.model?.trim() ||
    process.env.HAPPY2_OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
  if (!apiKey) {
    throw new OpenAiError(
      "OPENAI_API_KEY is not set — see backend/.env.example",
    );
  }

  const startedAt = Date.now();
  const transport = options.transport ?? fetch;
  const init: RequestInit = {
    method: "POST",
    signal: options.signal,
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ ...request, model, store: false }),
  };
  let raw = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    openAiLog.info("OpenAI request", { model, attempt: attempt + 1 });
    let response: Response;
    try {
      response = await transport("https://api.openai.com/v1/responses", init);
    } catch {
      if (attempt === 0 && !options.signal?.aborted) continue;
      throw new OpenAiError("OpenAI request failed");
    }
    raw = await response.text();
    if (response.ok) break;
    openAiLog.error("OpenAI rejected the request", {
      status: response.status,
      ms: since(startedAt),
    });
    if (attempt === 0 && transientStatus(response.status)) continue;
    throw new OpenAiError(
      `OpenAI rejected the request with HTTP ${response.status}`,
    );
  }

  let parsed: OpenAiResponse;
  try {
    parsed = JSON.parse(raw) as OpenAiResponse;
  } catch {
    throw new OpenAiError("OpenAI returned a malformed response");
  }
  if (parsed.status && parsed.status !== "completed") {
    throw new OpenAiError(
      `OpenAI response did not complete (${parsed.status})`,
    );
  }
  openAiLog.info("OpenAI reply", {
    ms: since(startedAt),
    out: parsed.usage?.output_tokens ?? 0,
  });
  return parsed;
}

export async function completeOpenAiJson<T>(
  system: string,
  user: string,
  schema: JsonSchema,
  maxTokens = 8_000,
  options: OpenAiResponseOptions = {},
): Promise<T> {
  const response = await createOpenAiResponse(
    {
      instructions: system,
      input: user,
      max_output_tokens: maxTokens,
      text: {
        format: {
          type: "json_schema",
          name: "happy2_surface_result",
          strict: true,
          schema,
        },
      },
    },
    options,
  );
  const text = openAiOutputText(response);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new OpenAiError("OpenAI output was not valid JSON");
  }
}

export function openAiOutputText(response: OpenAiResponse): string {
  const text = (response.output ?? [])
    .filter(isRecord)
    .filter((item) => item.type === "message" && Array.isArray(item.content))
    .flatMap((item) => item.content as unknown[])
    .filter(isRecord)
    .filter(
      (content) =>
        content.type === "output_text" && typeof content.text === "string",
    )
    .map((content) => content.text as string)
    .join("");
  if (!text) throw new OpenAiError("OpenAI returned no text output");
  return text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function transientStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}
