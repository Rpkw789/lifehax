import { BaseSearchAgent } from "./base.ts";
import type { WebSearchClient } from "./types.ts";

export class OpenAISearchAgent extends BaseSearchAgent {
  readonly kind = "shared-search" as const;
  readonly model: string;
  protected readonly endpoint = "openai:responses";

  constructor(client: WebSearchClient, model: string) {
    super(client);
    this.model = model;
  }
}
