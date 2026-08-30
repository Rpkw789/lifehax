import { describe, expect, test } from "bun:test";
import { completeJson, completeOpenAiJson, LlmError } from "./llm.ts";

describe("completeJson", () => {
  test("uses the AI Gateway compat endpoint and provider-prefixed model", async () => {
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
        gatewayId: "gw-1",
        model: "anthropic/claude-sonnet-4-5",
        transport: async (input, init) => {
          capturedUrl = String(input);
          capturedHeaders = new Headers(init?.headers);
          capturedBody = JSON.parse(String(init?.body)) as Record<
            string,
            unknown
          >;
          return Response.json({
            choices: [{ message: { content: '{"ok":true}' } }],
          });
        },
      },
    );

    expect(capturedUrl).toBe(
      "https://gateway.ai.cloudflare.com/v1/account-1/gw-1/compat/chat/completions",
    );
    // The Cloudflare token goes in cf-aig-authorization; `authorization` is the
    // provider slot and putting our token there is what returned a bare 401.
    expect(capturedHeaders.get("cf-aig-authorization")).toBe("Bearer token-1");
    expect(capturedHeaders.get("authorization")).toBeNull();
    expect(capturedBody.model).toBe("anthropic/claude-sonnet-4-5");
    expect(capturedBody.messages).toEqual([
      { role: "system", content: "Return JSON.\n\nReturn only one JSON value matching this JSON Schema:\n\n{\"type\":\"object\"}" },
      { role: "user", content: "Evaluate evidence." },
    ]);
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
        gatewayId: "gw-1",
        model: "anthropic/claude-sonnet-4-5",
        transport: async (_input, init) => {
          bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          return Response.json({
            choices: [
              {
                message: {
                  content: bodies.length === 1 ? "not json" : '{"ok":true}',
                },
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
        gatewayId: "gw-1",
        model: "anthropic/claude-sonnet-4-5",
        transport: async () =>
          new Response("Bearer token-1 was rejected", { status: 401 }),
      },
    );

    expect(promise).rejects.toBeInstanceOf(LlmError);
    expect(promise).rejects.not.toThrow("token-1");
  });

  test("passes the caller abort signal to Cloudflare", async () => {
    const controller = new AbortController();
    let receivedSameSignal = false;
    await completeJson(
      "Return JSON.",
      "Evaluate evidence.",
      { type: "object" },
      500,
      {
        accountId: "account-1",
        apiToken: "token-1",
        gatewayId: "gw-1",
        signal: controller.signal,
        transport: async (_input, init) => {
          receivedSameSignal = init?.signal === controller.signal;
          return Response.json({ choices: [{ message: { content: "{}" } }] });
        },
      },
    );
    expect(receivedSameSignal).toBe(true);
  });
});

describe("completeOpenAiJson", () => {
  test("posts a strict JSON-schema request directly to the Responses API", async () => {
    let requestedUrl = "";
    let authorization = "";
    let body: Record<string, unknown> = {};
    const result = await completeOpenAiJson<{ ok: boolean }>(
      "Use the supplied evidence only.",
      "Assess this surface.",
      {
        type: "object",
        properties: { ok: { type: "boolean" } },
        required: ["ok"],
        additionalProperties: false,
      },
      1_000,
      {
        apiKey: "openai-secret",
        model: "gpt-5-mini",
        transport: async (url, init) => {
          requestedUrl = String(url);
          authorization = new Headers(init?.headers).get("authorization") ?? "";
          body = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return Response.json({
            id: "resp_test",
            status: "completed",
            output: [
              {
                type: "message",
                role: "assistant",
                content: [
                  {
                    type: "output_text",
                    text: JSON.stringify({ ok: true }),
                    annotations: [],
                  },
                ],
              },
            ],
          });
        },
      },
    );

    expect(requestedUrl).toBe("https://api.openai.com/v1/responses");
    expect(authorization).toBe("Bearer openai-secret");
    expect(body.model).toBe("gpt-5-mini");
    expect(body.store).toBe(false);
    expect(body.max_output_tokens).toBe(1_000);
    expect((body.text as { format: { type: string; strict: boolean } }).format)
      .toMatchObject({ type: "json_schema", strict: true });
    expect(result).toEqual({ ok: true });
  });
});
