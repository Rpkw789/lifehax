/**
 * One LLM entry point, via the Cloudflare AI Gateway REST API.
 *
 * Uses `POST /ai/v1/messages` on api.cloudflare.com, which speaks the Anthropic
 * Messages schema verbatim. Note this is *not* the older
 * `gateway.ai.cloudflare.com/.../anthropic` passthrough, nor
 * `/compat/chat/completions` (deprecated for single-model calls) — both of
 * which dominate search results. No SDK; auth is a Cloudflare API token with
 * Account > Workers AI > Read, billed through Unified Billing.
 */

const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
const TOKEN = process.env.CLOUDFLARE_API_TOKEN ?? "";
const MODEL = process.env.HAPPY2_MODEL ?? "anthropic/claude-sonnet-4-5";
const GATEWAY = process.env.CLOUDFLARE_GATEWAY_ID ?? "default";

export class LlmError extends Error {}

export function llmConfigured(): boolean {
  return Boolean(ACCOUNT && TOKEN);
}

interface MessagesResponse {
  content?: { type: string; text?: string }[];
  error?: { message?: string };
  errors?: { message?: string }[];
}

async function complete(system: string, user: string, maxTokens: number): Promise<string> {
  if (!llmConfigured()) {
    throw new LlmError(
      "CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are not set — see backend/.env.example",
    );
  }

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/v1/messages`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "cf-aig-gateway-id": GATEWAY,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
      }),
    },
  );

  const raw = await res.text();
  if (!res.ok) {
    throw new LlmError(`gateway ${res.status}: ${raw.slice(0, 400)}`);
  }

  let parsed: MessagesResponse;
  try {
    parsed = JSON.parse(raw) as MessagesResponse;
  } catch {
    throw new LlmError(`gateway returned non-JSON: ${raw.slice(0, 200)}`);
  }

  const text = parsed.content?.find((b) => b.type === "text")?.text;
  if (!text) {
    const why = parsed.error?.message ?? parsed.errors?.[0]?.message ?? raw.slice(0, 200);
    throw new LlmError(`gateway returned no text block: ${why}`);
  }
  return text;
}

/**
 * A completion parsed as JSON. Structured outputs are not relied on surviving
 * the gateway, so we ask for JSON in the prompt and parse defensively, with one
 * retry that shows the model its own broken output.
 */
export async function completeJson<T>(
  system: string,
  user: string,
  maxTokens = 8000,
): Promise<T> {
  const instruction = `${system}\n\nReply with JSON only. No prose, no markdown fences.`;
  let last = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt =
      attempt === 0
        ? user
        : `${user}\n\nYour previous reply was not valid JSON. Here it is:\n${last.slice(0, 1000)}\n\nReply again with valid JSON only.`;
    last = await complete(instruction, prompt, maxTokens);
    const parsed = tryParse<T>(last);
    if (parsed !== undefined) return parsed;
  }
  throw new LlmError(`model did not return valid JSON after 2 attempts`);
}

function tryParse<T>(text: string): T | undefined {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Fall back to the outermost {...} or [...] in the reply.
    const start = cleaned.search(/[[{]/);
    const end = Math.max(cleaned.lastIndexOf("]"), cleaned.lastIndexOf("}"));
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1)) as T;
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}
