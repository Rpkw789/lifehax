/**
 * The one LLM entry point, via Cloudflare AI Gateway's Anthropic
 * provider-native endpoint:
 *
 *   POST https://gateway.ai.cloudflare.com/v1/{account}/{gateway}/anthropic/v1/messages
 *
 * This speaks the Anthropic Messages API exactly, so structured outputs,
 * adaptive thinking and the rest are available unchanged. The gateway holds the
 * Anthropic key via BYOK, so no provider key appears here — authentication is
 * the AI Gateway token in `cf-aig-authorization`.
 *
 * Two things that cost an hour if you get them wrong:
 *   - The token is an **AI Gateway token** (permission `AI Gateway Run`), not a
 *     general Cloudflare API token. A normal API token fails with a bare
 *     `401 Authentication error` that says nothing about permissions.
 *   - `CLOUDFLARE_GATEWAY_ID` must be the gateway's real name. "default" only
 *     works if a gateway is literally called that.
 *
 * No SDK. Never log the token.
 */

import { logger, since } from "./log";

const llmLog = logger("llm");

const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
/** Accept either name; this is the AI Gateway token, whatever it is called. */
const TOKEN =
  process.env.CLOUDFLARE_AIG_TOKEN ?? process.env.CLOUDFLARE_API_TOKEN ?? "";
const GATEWAY = process.env.CLOUDFLARE_GATEWAY_ID ?? "default";
/**
 * The provider-native endpoint takes a bare Anthropic model id. The REST API on
 * api.cloudflare.com takes a provider-prefixed one ("anthropic/claude-..."), so
 * strip the prefix rather than 404 on a value that looks perfectly reasonable.
 */
const MODEL = (process.env.HAPPY2_MODEL ?? "claude-opus-5").replace(
  /^anthropic\//,
  "",
);

const ENDPOINT = `https://gateway.ai.cloudflare.com/v1/${ACCOUNT}/${GATEWAY}/anthropic/v1/messages`;

/** Opus/Sonnet/Fable 5 and the 4.6-4.8 family. Older models 400 on it. */
const SUPPORTS_ADAPTIVE_THINKING =
  /^claude-(opus|sonnet|fable|mythos)-5|^claude-opus-4-[678]|^claude-sonnet-4-6/.test(
    MODEL,
  );

export class LlmError extends Error {}

export function llmConfigured(): boolean {
  return Boolean(ACCOUNT && TOKEN);
}

/** A JSON Schema describing the reply. Structured outputs enforce it. */
export type JsonSchema = Record<string, unknown>;

interface MessagesResponse {
  content?: { type: string; text?: string }[];
  stop_reason?: string;
  error?: { message?: string };
  usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * Asks for a reply matching `schema` and returns it parsed.
 *
 * `output_config.format` makes the model emit conforming JSON rather than prose
 * we have to scrape, so there is no fence-stripping or retry loop here.
 */
export async function completeJson<T>(
  system: string,
  user: string,
  schema: JsonSchema,
  maxTokens = 8000,
): Promise<T> {
  if (!llmConfigured()) {
    throw new LlmError(
      "CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are not set — see backend/.env.example",
    );
  }

  const startedAt = Date.now();
  llmLog.info("request", { model: MODEL, gateway: GATEWAY, chars: user.length });

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "cf-aig-authorization": `Bearer ${TOKEN}`,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      // Adaptive thinking only exists on 4.6-and-later models; older ones
      // reject it outright rather than ignoring it.
      ...(SUPPORTS_ADAPTIVE_THINKING ? { thinking: { type: "adaptive" } } : {}),
      output_config: { format: { type: "json_schema", schema } },
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  const raw = await res.text();

  if (!res.ok) {
    llmLog.error("gateway rejected the request", {
      status: res.status,
      ms: since(startedAt),
      body: raw.slice(0, 200),
      ...(res.status === 401
        ? {
            hint: `is CLOUDFLARE_GATEWAY_ID ("${GATEWAY}") the real gateway name, and is the token an AI Gateway token with Run permission?`,
          }
        : {}),
    });
    throw new LlmError(`gateway ${res.status}: ${raw.slice(0, 300)}`);
  }

  let parsed: MessagesResponse;
  try {
    parsed = JSON.parse(raw) as MessagesResponse;
  } catch {
    throw new LlmError(`gateway returned non-JSON: ${raw.slice(0, 200)}`);
  }

  // Adaptive thinking puts thinking blocks alongside the answer; take the text.
  const text = parsed.content?.find((b) => b.type === "text")?.text;
  if (!text) {
    const why = parsed.error?.message ?? raw.slice(0, 200);
    llmLog.error("no completion returned", { ms: since(startedAt), why });
    throw new LlmError(`gateway returned no completion: ${why}`);
  }

  llmLog.info("reply", {
    ms: since(startedAt),
    chars: text.length,
    out: parsed.usage?.output_tokens ?? 0,
  });

  try {
    return JSON.parse(text) as T;
  } catch {
    // Structured outputs should make this unreachable; if the API ever relaxes
    // that guarantee we want a loud, specific failure rather than a silent one.
    llmLog.error("structured output was not valid JSON", {
      head: text.slice(0, 160).replace(/\s+/g, " "),
    });
    throw new LlmError("structured output was not valid JSON");
  }
}
