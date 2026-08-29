import { BaseSearchAgent } from "./base.ts";

export class NativeSearchAgent extends BaseSearchAgent {
  readonly kind = "native-search" as const;
  readonly model = "claude-opus-5";
  protected readonly endpoint = "anthropic:messages";
}
