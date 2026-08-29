export interface JsonGenerationRequest {
  model: string;
  maxTokens: number;
  prompt: string;
  schema: Record<string, unknown>;
  thinking: { type: "adaptive" };
  stream: boolean;
  signal?: AbortSignal;
}

export interface StructuredModelClient {
  generateJson<T>(request: JsonGenerationRequest): Promise<T>;
}
