import { contentAttributesRule, contentShippingRule } from "./content";
import { discoverySourcesRule } from "./discovery";
import { protocolLlmsTxtRule, protocolManifestRule } from "./protocol";
import { structuredOfferRule } from "./structured";
import type { Rule } from "../types";

/** Registration order is irrelevant — output order comes from ranking. */
export const RULES: readonly Rule[] = [
  discoverySourcesRule,
  protocolManifestRule,
  protocolLlmsTxtRule,
  structuredOfferRule,
  contentAttributesRule,
  contentShippingRule,
];
