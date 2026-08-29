import { expect, test } from "bun:test";

import {
  createOpenAiSurfaceServices,
  createOpenAiSurfaceServicesFromEnv,
} from "./openai.ts";

test("surface OpenAI services provide direct critique and search clients", async () => {
  let requestedUrl = "";
  const services = createOpenAiSurfaceServices({
    apiKey: "openai-secret",
    transport: async (url) => {
      requestedUrl = String(url);
      return Response.json({
        id: "resp_critique",
        status: "completed",
        output: [
          {
            type: "message",
            role: "assistant",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({ summary: "Evidence-backed" }),
                annotations: [],
              },
            ],
          },
        ],
      });
    },
  });

  const result = await services.critiqueClient(
    "Use evidence only.",
    "Assess the surface.",
    {
      type: "object",
      properties: { summary: { type: "string" } },
      required: ["summary"],
      additionalProperties: false,
    },
  );

  expect(requestedUrl).toBe("https://api.openai.com/v1/responses");
  expect(result).toEqual({ summary: "Evidence-backed" });
  expect(services.agent.model).toBe("gpt-5-mini");
  expect(services.agent.kind).toBe("shared-search");
});

test("surface OpenAI services are selected from runtime configuration", () => {
  expect(createOpenAiSurfaceServicesFromEnv({})).toBeUndefined();
  const configured = createOpenAiSurfaceServicesFromEnv({
    OPENAI_API_KEY: "openai-secret",
    HAPPY2_OPENAI_MODEL: "gpt-configured",
  });
  expect(configured?.agent.model).toBe("gpt-configured");
});
