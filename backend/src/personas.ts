/**
 * Shopper briefs, generated per run from the store's own catalogue.
 *
 * Hard rule 1 (AGENTS.md): no product category may appear in source. The
 * archetypes below are category-agnostic; every word a shopper actually says is
 * generated at runtime from the products we found. The same code path serves
 * soap, running shoes and skincare unmodified.
 */

import { completeJson, llmConfigured, type JsonSchema } from "./llm";
import type { Catalogue, Persona, PersonaOverride } from "./types";

/** Category-agnostic intents. Safe to hardcode: none names a product type. */
const ARCHETYPES = [
  { key: "budget-led", tag: "BGN", color: "#c2760a" },
  { key: "spec-led", tag: "SPC", color: "#2563eb" },
  { key: "gift", tag: "GFT", color: "#7c3aed" },
  { key: "bulk", tag: "BLK", color: "#0b8a5d" },
  { key: "urgent", tag: "RSH", color: "#d02a2a" },
] as const;

const SYSTEM = `You write shopper briefs for a storefront readiness audit.

Given a store's catalogue, write TWO briefs per intent archetype — two
different people who happen to shop the same way. Each brief is what that
shopper would type into an AI shopping assistant: first person, their own
words, naming concrete attributes from the real catalogue.

Rules:
- Ground every brief in products that actually appear in the catalogue.
- The two briefs for an archetype must want DIFFERENT products, or the same
  product for visibly different reasons. Never restate one as the other.
- Vary the shape of the request across the whole set: some name a product,
  some describe a problem, some ask a question, some give constraints only.
- Mention real attributes and realistic prices from the catalogue.
- One or two sentences. No preamble, no quotes around the text.
- "name" is a 2-3 word label for the shopper, not the product, and the two
  shoppers in an archetype get different names.

Write two briefs per archetype, in the order the archetypes are given.`;

interface Generated {
  archetype: string;
  name: string;
  prompt: string;
}

/** What a run needs: archetypes for display, one brief per agent. */
export interface Briefing {
  personas: Persona[];
  briefs: string[];
}

/** Two agents per archetype, so the model is asked for twice as many. */
const PER_ARCHETYPE = 2;

/** Structured-output contract, so the reply needs no parsing or repair. */
const PERSONA_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    personas: {
      type: "array",
      items: {
        type: "object",
        properties: {
          archetype: { type: "string", enum: ARCHETYPES.map((a) => a.key) },
          name: { type: "string" },
          prompt: { type: "string" },
        },
        required: ["archetype", "name", "prompt"],
        additionalProperties: false,
      },
    },
  },
  required: ["personas"],
  additionalProperties: false,
};

/**
 * The population for a run: written from the catalogue, then overwritten
 * wherever this store's owner has edited a brief on the personas screen.
 *
 * Overrides are applied outside the generator so both paths through it — the
 * model and the offline fallback — honour an edit identically. A model outage
 * must not silently discard what someone typed.
 */
export async function generatePersonas(
  catalogue: Catalogue,
  overrides: PersonaOverride[] = [],
): Promise<Briefing> {
  return applyOverrides(await writeBriefing(catalogue), overrides);
}

/**
 * Replaces the named fields, seat by seat, leaving every untouched seat with
 * the brief the generator wrote for this catalogue. `personas[i].prompt` stays
 * the first seat's brief, which is the invariant the rest of the app reads.
 */
function applyOverrides(
  briefing: Briefing,
  overrides: PersonaOverride[],
): Briefing {
  if (overrides.length === 0) return briefing;

  const personas = briefing.personas.map((p) => ({ ...p }));
  const briefs = [...briefing.briefs];

  for (const override of overrides) {
    const index = personas.findIndex((p) => p.tag === override.tag);
    if (index === -1) continue;

    const name = override.name?.trim();
    if (name) personas[index]!.name = name;

    override.briefs?.forEach((brief, seat) => {
      const text = brief?.trim();
      if (!text || seat >= PER_ARCHETYPE) return;
      briefs[index * PER_ARCHETYPE + seat] = text;
      if (seat === 0) personas[index]!.prompt = text;
    });
  }

  return { personas, briefs };
}

async function writeBriefing(catalogue: Catalogue): Promise<Briefing> {
  if (!llmConfigured() || catalogue.products.length === 0) {
    return fallbackBriefing(catalogue);
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
    const { personas: generated } = await completeJson<{ personas: Generated[] }>(
      SYSTEM,
      user,
      PERSONA_SCHEMA,
      3000,
    );

    const personas: Persona[] = [];
    const briefs: string[] = [];

    ARCHETYPES.forEach((arch, archIndex) => {
      const mine = generated.filter((g) => g.archetype === arch.key);
      for (let n = 0; n < PER_ARCHETYPE; n++) {
        // Fall back through this archetype's own results, then the flat list,
        // so a model that ignored the grouping still yields distinct briefs.
        const match = mine[n] ?? generated[archIndex * PER_ARCHETYPE + n];
        briefs.push(match?.prompt?.trim() || genericPrompt(arch.key, catalogue));
        if (n === 0) {
          personas.push({
            name: match?.name?.trim() || titleCase(arch.key),
            prompt: match?.prompt?.trim() || genericPrompt(arch.key, catalogue),
            color: arch.color,
            tag: arch.tag,
          });
        }
      }
    });

    return { personas, briefs };
  } catch {
    // A failed generation must not kill the run; the audit is the real payload.
    return fallbackBriefing(catalogue);
  }
}

/**
 * Used when the model is unavailable. Still category-free: the prompts are
 * assembled from whatever this store actually sells.
 */
function fallbackBriefing(catalogue: Catalogue): Briefing {
  const personas = ARCHETYPES.map((arch) => ({
    name: titleCase(arch.key),
    prompt: genericPrompt(arch.key, catalogue),
    color: arch.color,
    tag: arch.tag,
  }));
  // Two agents per archetype, each pointed at a different product so they do
  // not retrace each other even without a model.
  const briefs = ARCHETYPES.flatMap((arch, i) =>
    Array.from({ length: PER_ARCHETYPE }, (_, n) =>
      genericPrompt(arch.key, catalogue, i * PER_ARCHETYPE + n),
    ),
  );
  return { personas, briefs };
}

function genericPrompt(
  archetype: string,
  catalogue: Catalogue,
  seat = 0,
): string {
  const sample = catalogue.products[seat % Math.max(1, catalogue.products.length)];
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
