import { describe, expect, test } from "bun:test";
import { completeJson, LlmError } from "./llm.ts";

describe("completeJson", () => {
  test("uses the Cloudflare account messages endpoint and provider-prefixed model", async () => {
    let capturedUrl = "";
    let capturedHeaders = new Headers();
    let capturedBody: Record<string, unknown> = {};

    const result = await completeJson<{ ok: boolean }>(
      "Return JSON.",
      "Evaluate evidence.",
      { type: "object" },
      500,
      {
        accountId: "account-1",
        apiToken: "token-1",
        model: "anthropic/claude-sonnet-4-5",
        transport: async (input, init) => {
          capturedUrl = String(input);
          capturedHeaders = new Headers(init?.headers);
          capturedBody = JSON.parse(String(init?.body)) as Record<
            string,
            unknown
          >;
          return Response.json({
            content: [{ type: "text", text: '{"ok":true}' }],
          });
        },
      },
    );

    expect(capturedUrl).toBe(
      "https://api.cloudflare.com/client/v4/accounts/account-1/ai/v1/messages",
    );
    expect(capturedHeaders.get("authorization")).toBe("Bearer token-1");
    expect(capturedBody.model).toBe("anthropic/claude-sonnet-4-5");
    expect(result).toEqual({ ok: true });
  });

  test("retries malformed JSON once with the rejected output", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const result = await completeJson<{ ok: boolean }>(
      "Return JSON.",
      "Evaluate evidence.",
      { type: "object" },
      500,
      {
        accountId: "account-1",
        apiToken: "token-1",
        model: "anthropic/claude-sonnet-4-5",
        transport: async (_input, init) => {
          bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          return Response.json({
            content: [
              {
                type: "text",
                text: bodies.length === 1 ? "not json" : '{"ok":true}',
              },
            ],
          });
        },
      },
    );

    expect(bodies).toHaveLength(2);
    expect(JSON.stringify(bodies[1])).toContain("not json");
    expect(result).toEqual({ ok: true });
  });

  test("does not expose credentials in gateway errors", async () => {
    const promise = completeJson(
      "Return JSON.",
      "Evaluate evidence.",
      { type: "object" },
      500,
      {
        accountId: "account-1",
        apiToken: "token-1",
        model: "anthropic/claude-sonnet-4-5",
        transport: async () =>
          new Response("Bearer token-1 was rejected", { status: 401 }),
      },
    );

    expect(promise).rejects.toBeInstanceOf(LlmError);
    expect(promise).rejects.not.toThrow("token-1");
  });
});
