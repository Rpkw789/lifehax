import { BaseSearchAgent } from "./base.ts";

export class SharedSearchAgent extends BaseSearchAgent {
  readonly kind = "shared-search" as const;
  readonly model = "anthropic/claude-opus-4.8";
  protected readonly endpoint = "cloudflare:anthropic/messages";
}
