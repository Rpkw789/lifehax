/**
 * Shopper briefs, generated per run from the store's own catalogue.
 *
 * Hard rule 1 (AGENTS.md): no product category may appear in source. The
 * archetypes below are category-agnostic; every word a shopper actually says is
 * generated at runtime from the products we found. The same code path serves
 * soap, running shoes and skincare unmodified.
 */

import { completeJson, llmConfigured } from "./llm";
import type { Catalogue, Persona } from "./types";

/** Category-agnostic intents. Safe to hardcode: none names a product type. */
const ARCHETYPES = [
  { key: "budget-led", tag: "BGN", color: "#c2760a" },
  { key: "spec-led", tag: "SPC", color: "#2563eb" },
  { key: "gift", tag: "GFT", color: "#7c3aed" },
  { key: "bulk", tag: "BLK", color: "#0b8a5d" },
  { key: "urgent", tag: "RSH", color: "#d02a2a" },
] as const;

const SYSTEM = `You write shopper briefs for a storefront readiness audit.

Given a store's catalogue, write one brief per intent archetype. Each brief is
what that shopper would type into an AI shopping assistant — first person, in
their own words, naming concrete attributes drawn from the real catalogue.

Rules:
- Ground every brief in products that actually appear in the catalogue.
- Mention real attributes and realistic prices from the catalogue.
- One or two sentences. No preamble, no quotes around the text.
- "name" is a 2-3 word label for the shopper, not the product.

Return: [{"archetype": "...", "name": "...", "prompt": "..."}]`;

interface Generated {
  archetype: string;
  name: string;
  prompt: string;
}

export async function generatePersonas(catalogue: Catalogue): Promise<Persona[]> {
  if (!llmConfigured() || catalogue.products.length === 0) {
    return fallbackPersonas(catalogue);
  }

  const summary = {
    domain: catalogue.domain,
    products: catalogue.products.slice(0, 12).map((p) => ({
      title: p.title,
      price: p.price,
      attributes: p.attributes,
    })),
  };

  const user = `Catalogue:\n${JSON.stringify(summary, null, 2)}\n\nArchetypes: ${ARCHETYPES.map((a) => a.key).join(", ")}`;

  try {
    const generated = await completeJson<Generated[]>(SYSTEM, user, 2000);
    return ARCHETYPES.map((arch, i) => {
      const match =
        generated.find((g) => g.archetype === arch.key) ?? generated[i];
      return {
        name: match?.name?.trim() || titleCase(arch.key),
        prompt: match?.prompt?.trim() || genericPrompt(arch.key, catalogue),
        color: arch.color,
        tag: arch.tag,
      };
    });
  } catch {
    // A failed generation must not kill the run; the audit is the real payload.
    return fallbackPersonas(catalogue);
  }
}

/**
 * Used when the model is unavailable. Still category-free: the prompts are
 * assembled from whatever this store actually sells.
 */
function fallbackPersonas(catalogue: Catalogue): Persona[] {
  return ARCHETYPES.map((arch) => ({
    name: titleCase(arch.key),
    prompt: genericPrompt(arch.key, catalogue),
    color: arch.color,
    tag: arch.tag,
  }));
}

function genericPrompt(archetype: string, catalogue: Catalogue): string {
  const sample = catalogue.products[0];
  const what = sample?.title ?? "something from this store";
  const price = sample?.price ? `$${sample.price}` : "my budget";
  switch (archetype) {
    case "budget-led":
      return `the cheapest option like "${what}" that ships free, brand does not matter`;
    case "spec-led":
      return `something like "${what}" that matches my exact requirements`;
    case "gift":
      return `a gift for someone, around ${price}`;
    case "bulk":
      return `40 units of something like "${what}", delivered to one address`;
    default:
      return `"${what}" in stock and arriving this week, one click`;
  }
}

function titleCase(key: string): string {
  return key
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
