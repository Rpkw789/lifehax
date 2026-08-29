/**
 * Code registries for agent-run outcomes.
 *
 * Codes are category-agnostic by construction. Anything product-specific is
 * carried in the `attribute` field, never in the code itself — a code named
 * MISSING_WATERPROOF_EVIDENCE would make the codebase know about footwear, and
 * the same code path has to serve soap and skincare unmodified.
 */

/** Why the target product was not recommended, or was recommended weakly. */
export const FAILURE_CODES = [
  // Discovery — the agent never retrieved us
  "NOT_IN_SEARCH_RESULTS",
  "NOT_IN_SITEMAP",
  "NO_PRODUCT_FEED",
  "ROBOTS_BLOCKED",

  // Parsing — the agent retrieved us but could not read the facts
  "NO_STRUCTURED_DATA",
  "NO_OFFER_SCHEMA",
  "PRICE_CLIENT_SIDE_ONLY",
  "PRICE_NOT_FOUND",
  "AVAILABILITY_NOT_FOUND",
  "SPECS_IN_IMAGES_ONLY",
  "MISSING_ATTRIBUTE_EVIDENCE",
  "SHIPPING_INFO_NOT_FOUND",
  "RETURN_POLICY_NOT_FOUND",
  "NO_REVIEW_EVIDENCE",

  // Protocol — no machine-readable buying surface
  "NO_LLMS_TXT",
  "ACP_UNSUPPORTED",
  "UCP_UNSUPPORTED",

  // Competition — we were readable but lost
  "OUTRANKED_BY_COMPETITOR",
  "PRICE_ABOVE_BUDGET",

  // Infrastructure — the run itself degraded
  "AGENT_ERROR",
  "AGENT_TIMEOUT",
] as const;

export type FailureCode = (typeof FAILURE_CODES)[number];

/** Why a candidate landed at its rank. Applies to competitors too. */
export const REASON_CODES = [
  "PRICE_MATCH",
  "PRICE_ABOVE_BUDGET",
  "PRICE_UNKNOWN",
  "STRONG_REVIEW_EVIDENCE",
  "WEAK_REVIEW_EVIDENCE",
  "CLEAR_ATTRIBUTE_CLAIM",
  "WEAK_ATTRIBUTE_CLAIM",
  "ATTRIBUTE_ABSENT",
  "IN_STOCK",
  "STOCK_UNKNOWN",
  "SHIPPING_CLEAR",
  "SHIPPING_UNCLEAR",
  "STRUCTURED_DATA_PRESENT",
  "STRUCTURED_DATA_ABSENT",
] as const;

export type ReasonCode = (typeof REASON_CODES)[number];

/**
 * A code with its parameters. `attribute` names the product attribute the code
 * refers to when the code is attribute-scoped (MISSING_ATTRIBUTE_EVIDENCE,
 * CLEAR_ATTRIBUTE_CLAIM, WEAK_ATTRIBUTE_CLAIM, ATTRIBUTE_ABSENT).
 */
export interface CodedFinding<T extends string> {
  code: T;
  /** Runtime value, e.g. "waterproof", "fragrance-free". Never a code member. */
  attribute?: string;
  /** Human-readable detail for display. Never parsed. */
  note?: string;
}

export type FailureEntry = CodedFinding<FailureCode>;
export type ReasonEntry = CodedFinding<ReasonCode>;

/** Codes whose meaning depends on `attribute` being set. */
export const ATTRIBUTE_SCOPED_CODES: readonly string[] = [
  "MISSING_ATTRIBUTE_EVIDENCE",
  "CLEAR_ATTRIBUTE_CLAIM",
  "WEAK_ATTRIBUTE_CLAIM",
  "ATTRIBUTE_ABSENT",
];
