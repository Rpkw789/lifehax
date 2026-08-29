import { OpenAISearchAgent } from "../agents/openai-search.ts";
import { OpenAIWebSearchClient } from "../agents/openai.ts";
import {
  completeOpenAiJson,
  type LlmTransport,
} from "../llm.ts";
import type { SurfaceCritiqueClient } from "./critique.ts";

const DEFAULT_OPENAI_MODEL = "gpt-5-mini";

interface OpenAiSurfaceOptions {
  apiKey: string;
  model?: string;
  transport?: LlmTransport;
}

export function createOpenAiSurfaceServices(options: OpenAiSurfaceOptions): {
  agent: OpenAISearchAgent;
  critiqueClient: SurfaceCritiqueClient;
} {
  const model = options.model?.trim() || DEFAULT_OPENAI_MODEL;
  const responseOptions = {
    apiKey: options.apiKey,
    model,
    ...(options.transport ? { transport: options.transport } : {}),
  };
  const client = new OpenAIWebSearchClient(responseOptions);
  return {
    agent: new OpenAISearchAgent(client, model),
    critiqueClient: (system, user, schema, signal) =>
      completeOpenAiJson<unknown>(system, user, schema, 8_000, {
        ...responseOptions,
        ...(signal ? { signal } : {}),
      }),
  };
}

export function createOpenAiSurfaceServicesFromEnv(
  env: Record<string, string | undefined>,
  transport?: LlmTransport,
): ReturnType<typeof createOpenAiSurfaceServices> | undefined {
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) return undefined;
  return createOpenAiSurfaceServices({
    apiKey,
    ...(env.HAPPY2_OPENAI_MODEL?.trim()
      ? { model: env.HAPPY2_OPENAI_MODEL.trim() }
      : {}),
    ...(transport ? { transport } : {}),
  });
}
