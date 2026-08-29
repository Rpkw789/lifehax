# Happy2 — Design

**Date:** 2026-08-29
**Status:** Approved, pre-implementation

## Problem

Consumers increasingly shop through AI assistants rather than keyword search. They
ask "I'm training for a half marathon in Singapore's humid weather and need
lightweight shoes under S$200" rather than "running shoes size 10". An AI agent
can only recommend a product it can find, parse, and reason about. Most brands
publish content built for human browsers and search-engine crawlers, so they are
invisible to this channel and have no way to measure it.

Happy2 closes that gap with a loop rather than a one-off audit: measure whether
agents find you, diagnose why they didn't, generate the fix, then re-measure.

## Stages

| Stage | Route | What happens |
| --- | --- | --- |
| Input | `/runs/:id/input` | Brand submits store URL(s); we snapshot the catalogue |
| Check | `/runs/:id/check` | ~20 generated shopper agents search for products like theirs; live feed |
| Recommend | `/runs/:id/recommend` | Ranked findings diagnosing why agents missed them |
| Create | `/runs/:id/create` | Targeted artifacts, published to a Happy2-hosted URL |

Create's artifacts are reachable by the agents on the next Check run, so the
second run's score moves for a real reason. The loop is self-verifying.

## Decisions

### D1 — Shopper agents use LLM + web search, not a headless browser

A real AI shopping assistant retrieves through search and fetch, so that is what
we emulate. Headless Chromium would measure Google SEO rather than agent
visibility, and it is slow and blocked in exactly the conditions a live demo
runs under. There is no Playwright dependency anywhere in this system.

The "live browser feed" in the UI is driven by real agent activity — queries
issued, URLs fetched, tool calls, verdicts — rendered into the existing tile
visualization. It is an honest view of what the agent did, not a screencast.

### D2 — Two agent implementations behind one interface

```ts
interface ShopperAgent {
  readonly kind: "shared-search" | "native-search"
  run(brief: PersonaBrief, ctx: RunContext): AsyncIterable<AgentEvent>
}
```

- `SharedSearchAgent` — a server-held Cloudflare AI Gateway token calls
  Anthropic Opus 4.8 with hosted web search. This is the default tier and does
  not require a brand-supplied model key.
- `NativeSearchAgent` — `claude-opus-5` with the provider-hosted `web_search`
  tool, so retrieval is the model's own. Unlocked when the brand supplies a key.

Both stream the same `AgentEvent` type, so the live feed, persistence, and
scoring are implementation-agnostic.

Each shopper uses two streamed requests: the first runs hosted web search and
collects citations. Same-origin cited pages are fetched through the guarded
store fetcher, then the second request turns that evidence into the
schema-constrained recommendation list. Anthropic citations and structured
outputs cannot be requested together, and deterministic matching accepts only
candidate URLs backed by citations from the first request.

### D3 — Personas are generated, never hardcoded

One model call turns the catalogue snapshot into ~20 `PersonaBrief`s. Intent
*archetypes* (budget-led, spec-led, gift, bulk, urgent, sustainability-led,
comparison-shopping, novice, replacement-buyer, constraint-led) are
category-agnostic constants. The prompts themselves are generated per catalogue.

No product category may appear in source code. The same code path must serve
soap, running shoes, and skincare without modification.

### D4 — Matching is deterministic

A shopper's result is a hit when a cited URL resolves to the brand's domain
(domain hit) or to a targeted product page (product hit). Rank is the citation's
position in the agent's recommendation list. No model judges whether a match
occurred. The verdict must survive a sceptical question about how it was
computed.

The model is used for generation and diagnosis, never for scoring.

### D5 — `CheckResult` is the parallelisation seam

One JSON document is the entire interface between Check and Evaluate. It is
defined and a realistic fixture committed before implementation starts, so
Evaluate, Create, and the dashboard can be built to completion against the
fixture while Check is still being written.

### D6 — Create publishes to Happy2-hosted URLs

Generated `llms.txt`, agent product feed, and JSON-LD are served from
`/hosted/:brandId/*`. The re-run supplies those URLs to the agents as
retrievable sources. This is what makes the loop verifiable without the brand
editing their site, and it is also the lowest-friction integration pathway a
brand can adopt — they point a redirect at it, or copy the file.

### D7 — `DEMO_MODE` replays a recorded run

Set `DEMO_MODE=<runId>` and the backend replays a persisted run from SQLite at
real-time pacing through the same event bus and the same renderer. It is a
recording of a real run, not fabricated data. Live demos are graded, and
conference networks fail.

### D8 — `competitorsAhead` is in scope

Each `ShopperResult` records which products outranked the brand's. It is the
most actionable number on the dashboard and costs nothing extra — the citations
are already in the response.

## Architecture

```
frontend/  Next.js 15, :3200 — four stage routes, live feed, dashboard
backend/   Bun + Hono, :3201 — run orchestration, agents, evaluation, hosting
```

```
POST /runs ──▶ queue ──▶ catalogue snapshot ──▶ persona generation
                              │
                              ▼
                  fan out ~20 ShopperAgents (concurrency capped)
                              │
              AgentEvent stream ──▶ SQLite ──▶ SSE ──▶ live feed
                              │
                              ▼
                        CheckResult JSON
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
               Evaluate            Dashboard
                    │
                    ▼
                 Create ──▶ /hosted/:brandId/* ──▶ next Check run
```

Persistence is `bun:sqlite`. Job execution is an in-process queue with a
concurrency cap. No Redis, no external worker, no container orchestration.

## Data flow

1. `POST /runs` validates input, snapshots the catalogue, returns a run id.
2. Worker generates personas, then fans out shopper agents under a concurrency
   cap. Every agent event is persisted then published to the run's bus.
3. `GET /runs/:id/events` is SSE. Reconnect replays from SQLite via
   `Last-Event-ID`, so a dropped connection loses nothing.
4. On completion the run's `CheckResult` is assembled and stored.
5. Evaluate reads `CheckResult` and writes ranked `Finding`s.
6. Create generates artifacts per finding and publishes them.

## Error handling

Agent failures are data. A shopper that times out or errors is recorded as a
non-hit whose `reason` is the error, and the run completes with 19 of 20
results rather than failing. Only failures that make the whole run meaningless —
the store URL does not resolve, persona generation fails after retry — move the
run to `error` with a message on the run resource.

Every model and search call has a timeout and one retry. A run has a wall-clock
budget; exceeding it completes the run with whatever results exist.

## Security

Brand-supplied API keys are held for the duration of a run and never written to
disk in plaintext, never logged, and never included in an `AgentEvent`. The live
feed logs the fact of a call and its endpoint, never its credentials. Outbound
crawling respects `robots.txt`, sends a truthful identifying user-agent, and is
rate-limited per host.

## Testing

Deterministic units — matching, scoring, site-audit extractors, artifact
generation, persona schema validation — are pure functions with unit tests.
Agent runs are tested against recorded search and model responses. CI makes no
network calls.

The committed `CheckResult` fixture is the shared test input for everything
downstream of Check.

## Rubric mapping

| Rubric | Where it is addressed |
| --- | --- |
| Problem comprehension | D1 and D4: we measure agent retrieval, deterministically |
| Solution architecture | D2 and D5: one agent interface, one contract, parallel workstreams |
| AI reasoning quality (live demo) | D1, D3, D7: real retrieval, generated intents, demo-safe replay |
| Scalability & generalisability | D3: no category-specific code, enforced in review |
| Brand adoptability | D6: hosted artifacts are the zero-access integration pathway |

## Out of scope for this spec

- On-site agent journey probing (add-to-cart, guest checkout, ACP/UCP
  transaction flows) beyond the fetch-based site audit
- Shopify/WooCommerce plugins and the install-once JS snippet
- Multi-tenant auth, billing, and account management
- Any headless-browser automation

## Change log

**2026-08-29 — D6 superseded.** The Create stage was dropped and its route
deleted (`68228aa`). Findings now carry a pasteable `snippet` instead of
generating and hosting artifacts, and the Recommend screen renders it. The loop
still closes: the brand applies a snippet, re-runs Check, and the new report
cites the previous one via `baseline_report_id` — the failure codes a finding
declared in `addresses_failure_codes` should stop appearing.

What this costs: the zero-site-access adoption path that answered rubric 5.
Adopting a fix is now a paste rather than a redirect. Hosted artifacts move to
the roadmap; `hosted_sources` stays in the contract, empty, so restoring them is
additive rather than a schema change.

**2026-08-29 — Finding contract standardised.** `Finding` moved to
`shared/contracts/finding.ts` in snake_case, with structured `evidence`,
resolvable `references`, and `addresses_failure_codes` linking each finding to
the observed codes it fixes. Derived values (`priority`, `shoppers_affected`)
are computed rather than stored.

**2026-08-29 — D2 shared-search transport revised.** The default agent now uses
Cloudflare AI Gateway's Anthropic web-search endpoint rather than a separate
search-results API followed by a model call. Cloudflare currently lists Opus
4.8 for this endpoint, so the shared tier is the narrow exception to the
repository's `claude-opus-5` default. The BYOK native tier remains direct
Anthropic `claude-opus-5`. Both produce the same internal proposal and event
types, and matching/scoring remain deterministic and provider-independent.
