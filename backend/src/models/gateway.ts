/**
 * Cloudflare AI Gateway addressing.
 *
 * Everything Cloudflare-bound goes through one gateway, but through two
 * different doors, and the difference is not cosmetic:
 *
 * - `/compat/chat/completions` speaks the OpenAI schema and takes a
 *   `{provider}/{model}` string. Plain prompt-in, text-out work uses it.
 * - `/anthropic/v1/messages` is a passthrough that preserves the Anthropic
 *   Messages schema. The shopper agents need it because `web_search` is an
 *   Anthropic *server-side* tool — it runs on Anthropic's infrastructure and
 *   has no OpenAI-schema equivalent, so translating those calls to compat
 *   would silently drop the retrieval that the whole measurement rests on.
 *
 * Both doors authenticate with `cf-aig-authorization`, not `Authorization`.
 * `Authorization` is the *provider* credential slot: under Unified Billing the
 * gateway supplies that itself, and sending our Cloudflare token there is what
 * produced a bare 401 with nothing in the body to explain it.
 */

/** Where a gateway lives. Both fields are required — see `gatewayTarget`. */
export interface GatewayTarget {
  accountId: string;
  gatewayId: string;
}

/**
 * The gateway named by the environment.
 *
 * Returns null rather than throwing so `llmConfigured()` can report "not
 * configured" without a try/catch. Callers that are about to spend a request
 * should use `requireGatewayTarget`.
 */
export function gatewayTarget(
  env: Record<string, string | undefined> = process.env,
): GatewayTarget | null {
  const accountId = (env.CLOUDFLARE_ACCOUNT_ID ?? "").trim();
  const gatewayId = (env.CLOUDFLARE_GATEWAY_ID ?? "").trim();
  if (!accountId || !gatewayId) return null;
  return { accountId, gatewayId };
}

/**
 * The gateway, or an error naming the missing half.
 *
 * `CLOUDFLARE_GATEWAY_ID` is easy to miss because nothing else in the app reads
 * it and an unset one used to build a `//` URL that 401s like a bad token. Name
 * it explicitly so the next person does not go looking at the token first.
 */
export function requireGatewayTarget(
  env: Record<string, string | undefined> = process.env,
): GatewayTarget {
  const target = gatewayTarget(env);
  if (target) return target;

  const missing = [
    (env.CLOUDFLARE_ACCOUNT_ID ?? "").trim() ? null : "CLOUDFLARE_ACCOUNT_ID",
    (env.CLOUDFLARE_GATEWAY_ID ?? "").trim() ? null : "CLOUDFLARE_GATEWAY_ID",
  ].filter((name): name is string => name !== null);

  throw new Error(
    `${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} not set — see backend/.env.example`,
  );
}

function base({ accountId, gatewayId }: GatewayTarget): string {
  return `https://gateway.ai.cloudflare.com/v1/${encodeURIComponent(accountId)}/${encodeURIComponent(gatewayId)}`;
}

/** OpenAI-schema endpoint. Model strings here are `{provider}/{model}`. */
export function compatChatCompletionsUrl(target: GatewayTarget): string {
  return `${base(target)}/compat/chat/completions`;
}

/** Anthropic Messages passthrough. Model strings here are bare Anthropic ids. */
export function anthropicMessagesUrl(target: GatewayTarget): string {
  return `${base(target)}/anthropic/v1/messages`;
}

/**
 * Gateway auth. `cf-aig-authorization` carries the Cloudflare token; the
 * provider key is left to Unified Billing, which is the point of routing here.
 */
export function gatewayHeaders(apiToken: string): Record<string, string> {
  return {
    "cf-aig-authorization": `Bearer ${apiToken}`,
    "content-type": "application/json",
  };
}
