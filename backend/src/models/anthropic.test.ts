import assert from "node:assert/strict";
import test from "node:test";

import { AnthropicStructuredClient } from "./anthropic.ts";
import type { JsonGenerationRequest } from "./types.ts";

test("AnthropicStructuredClient streams output_config.format requests", async () => {
  let sent: Record<string, unknown> | null = null;
  const client = new AnthropicStructuredClient({
    apiKey: "server-key",
    streamMessage: async (params) => {
      sent = params as unknown as Record<string, unknown>;
      return { content: [{ type: "text", text: "{\"value\":42}" }] };
    },
  });
  const request: JsonGenerationRequest = {
    model: "claude-opus-5",
    maxTokens: 100,
    prompt: "Generate",
    schema: { type: "object" },
    thinking: { type: "adaptive" },
    stream: true,
  };

  const result = await client.generateJson<{ value: number }>(request);

  assert.deepEqual(result, { value: 42 });
  const recorded = sent as Record<string, unknown> | null;
  assert.ok(recorded);
  assert.equal(recorded.stream, true);
  assert.deepEqual((recorded.output_config as Record<string, unknown>).format, { type: "json_schema", schema: { type: "object" } });
});
