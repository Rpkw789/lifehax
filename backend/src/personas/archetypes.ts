import type { IntentArchetype } from "../../../shared/contracts/check-result.ts";

export const INTENT_ARCHETYPES = [
  "product_discovery",
  "budget_led",
  "spec_led",
  "gift",
  "bulk",
  "urgent",
  "sustainability_led",
  "comparison",
  "novice",
  "replacement",
  "constraint_led",
] as const satisfies readonly IntentArchetype[];
