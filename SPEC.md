# Happy2 — Product Spec

## The problem

Commerce content is built for humans browsing and for keyword search engines.
Consumers are moving to intent-based requests through AI assistants:

> "I'm training for a half marathon in Singapore's humid weather and need
> lightweight shoes under S$200."

> "Find me a sustainable skincare routine for oily skin that takes less than
> five minutes every morning."

An AI agent recommends what it can retrieve, parse, and reason about. A brand
whose product data lives in page images, client-side JavaScript, and marketing
prose is invisible in this channel — and has no way to know it, because there is
no analytics surface for "did an AI assistant recommend me".

## What Happy2 does

A closed loop, not an audit report.

**0 · Input.** The brand submits store URLs. We snapshot the catalogue from the
sitemap, product feed, and on-page structured data.

**1 · Check (Simulate).** We generate ~20 shopper personas from that catalogue —
distinct intents, distinct phrasings — and run an agent per persona that searches
the web the way a real assistant does. For each: did the brand's product surface,
at what rank, and which competitors outranked it. Streamed live to the frontend:
every query issued, every URL fetched, every API call made.

**2 · Recommend (Evaluate).** The Check output is a JSON document. Evaluate reads
it and produces ranked findings, each citing the specific agents that failed and
the specific reason — no `llms.txt`, product absent from the sitemap, no
structured Offer data, no ACP/UCP manifest, price only rendered client-side.

**3 · Re-run.** Each finding ships with a pasteable snippet. The brand applies
it and runs Check again; the new report cites the previous one as its baseline
and the codes the fix addressed should stop appearing. The loop verifies itself
against the same measurement that produced the diagnosis.

## Why this is different

Content generators produce plausible copy against no measurement. Audit tools
produce a checklist against no verification. Every Happy2 finding names the
agent runs that produced it and the failure codes it addresses, and the fix is
proven by re-running the same measurement. Evidence in, evidence out.

## Scoring

Per run, from the shopper results:

| Metric | Definition |
| --- | --- |
| Hit rate | shoppers whose recommendations cited the brand / total shoppers |
| Mean rank | average citation position, over shoppers that found the brand |
| Per-persona breakdown | which intents surfaced the brand and which did not |
| Competitors ahead | products that outranked the brand, by frequency |

Plus four surface scores from the site audit: discoverability, structured data,
agent protocol, content quality.

A match is decided by URL: a cited URL on the brand's domain is a domain hit; one
resolving to a targeted product page is a product hit. Deterministic — no model
decides the verdict.

## Constraints that shape the build

- **Generalisability.** No product category appears in code. Personas are
  generated per catalogue from category-agnostic intent archetypes. Soap and
  running shoes take the same path.
- **Adoptability.** Every finding carries a pasteable snippet, so adopting a fix
  is a copy rather than a project. The roadmap reduces friction further: hosted
  artifacts, an install-once snippet, then platform plugins.
- **Demo reliability.** Live agent runs are graded live. `DEMO_MODE` replays a
  recorded real run through the same pipeline and renderer when the network is
  hostile.

## Tiers

- **Free.** Shared search layer plus a cheap model, under a per-account run
  quota. Always available.
- **Bring your own key.** The brand's key unlocks agents using provider-hosted
  search, so retrieval is the model's own and the result is maximally faithful.

## Success criteria

1. A run completes end to end for a store the team has never seen, in a category
   nobody wrote code for.
2. The findings on Recommend cite specific shopper IDs and observed facts.
3. Applying a finding's snippet and re-running moves the hit rate measurably.
4. The live feed shows real agent activity, not a scripted animation.
5. A brand can adopt at least one fix by pasting a snippet.

## Not in the MVP

A Create stage that generates and hosts artifacts (dropped 2026-08-29 — findings
carry snippets instead); on-site transaction probing beyond the fetch-based
audit; Shopify and WooCommerce plugins; the install-once JS snippet; multi-tenant
auth and billing; any headless-browser automation.
