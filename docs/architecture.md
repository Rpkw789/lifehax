# Architecture

Two services, one repo, no external infrastructure.

```
frontend/   Next.js 15 App Router, TypeScript, CSS Modules      :3200
backend/    Bun + Hono, TypeScript, bun:sqlite                  :3201
```

Nothing else. No Redis, no external worker, no container orchestration, no
headless browser. Added complexity needs to earn its place against a hackathon
timeline.

## Flow

```
        POST /runs
            │
            ▼
    ┌───────────────┐
    │ catalogue     │  sitemap · product feed · JSON-LD · raw HTML
    │ snapshot      │
    └───────┬───────┘
            │
            ▼
    ┌───────────────┐
    │ persona       │  1 model call → ~20 PersonaBriefs
    │ generation    │  archetypes are constants; prompts are generated
    └───────┬───────┘
            │
            ▼
    ┌───────────────────────────────────────────┐
    │ shopper fan-out (concurrency capped)      │
    │                                            │
    │  SharedSearchAgent   NativeSearchAgent     │
    │  search API + model  model-hosted search   │
    └───────┬───────────────────────────────────┘
            │  AgentEvent
            ▼
    ┌───────────────┐      ┌──────────┐      ┌───────────┐
    │ SQLite        │─────▶│ event bus│─────▶│ SSE       │──▶ live feed
    └───────┬───────┘      └──────────┘      └───────────┘
            │
            ▼
      CheckResult ──────┬──────────────▶ dashboard / analytics
                        │
                        ▼
                    Evaluate  →  Finding[]  (each carries a snippet)
                        │
                        └──────▶ brand applies it, re-runs Check
                                 new report cites the old as baseline
```

## Backend modules

```
backend/src/
  index.ts                Hono app, CORS for :3200, error handler
  env.ts                  typed config and limits

  http/
    runs.ts               POST /runs, GET /runs/:id
    events.ts             GET /runs/:id/events (SSE, Last-Event-ID replay)
    evaluate.ts           POST /runs/:id/evaluate
    errors.ts             JSON error shape

  runs/
    store.ts              bun:sqlite — runs, personas, shoppers, events, findings
    queue.ts              in-process job queue, concurrency cap
    bus.ts                per-run event fan-out to SSE subscribers
    orchestrator.ts       snapshot → personas → fan-out → assemble CheckResult

  catalogue/
    discover.ts           sitemap and feed discovery
    extract.ts            JSON-LD, meta, raw-HTML field extraction
    snapshot.ts           assembles CatalogueSnapshot

  personas/
    archetypes.ts         category-agnostic intent archetypes
    generate.ts           model call → PersonaBrief[]

  agents/
    types.ts              ShopperAgent interface, RunContext
    shared-search.ts      search API + model
    native-search.ts      claude-opus-5 with hosted web_search
    match.ts              deterministic URL matching → hit, rank, competitors

  audit/
    probes.ts             llms.txt, /.well-known/*, sitemap, robots
    structured.ts         JSON-LD and Offer coverage, client-side price

  score/
    compute.ts            RunScores from shoppers + audit

  evaluate/
    rules.ts              observation → candidate findings
    rank.ts               order by runs unblocked
    snippets.ts           the pasteable fix carried by each finding

  demo/
    replay.ts             DEMO_MODE — replays a recorded run through the bus
```

## The agent interface

The one abstraction that matters. Both tiers stream the same events, so
persistence, the live feed, matching, and scoring never branch on tier.

```ts
interface ShopperAgent {
  readonly kind: "shared-search" | "native-search";
  run(brief: PersonaBrief, ctx: RunContext): AsyncIterable<AgentEvent>;
}
```

`RunContext` carries the brand domain, target product, an abort signal, and the
credentials for this run — held in memory, never persisted.

## Live feed

The frontend's existing tile visualization (`RING_REGIONS`, `STAGE_URLS`,
`STAGE_ACTIONS` in `frontend/src/lib/fixtures.ts`) was always a stylized viewport
rather than a screencast. It is driven by real events:

| Event | Rendered as |
| --- | --- |
| `agent.query` | the query in the URL-bar slot |
| `agent.fetch` | fetched URL and status in the console |
| `agent.api` | endpoint and latency in the console |
| `agent.citation` | a result landing in the tile |
| `agent.verdict` | the tile settles to found or missed |

`frontend/src/lib/simulation.ts` currently derives state from the fixture `PLAN`.
It becomes a fold over received events. The `AgentState` shape and every
component stay as they are.

## Persistence

`bun:sqlite`, one file. Tables: `runs`, `personas`, `shoppers`, `events`,
`findings`. Events are append-only with the per-run sequence number
`t` as the ordering key, which is what makes SSE reconnect lossless and
`DEMO_MODE` replay possible.

## Failure behaviour

| Failure | Result |
| --- | --- |
| One shopper errors or times out | recorded as a non-hit with the error as `reason`; run continues |
| Search or model call fails | one retry, then the above |
| Store URL does not resolve | run moves to `error` before any agent runs |
| Persona generation fails after retry | run moves to `error` |
| Run exceeds wall-clock budget | completes with the results it has |

The distinction is whether the run still means something. A run with 19 of 20
results does. A run with no personas does not.

## Security

Brand keys are request-scoped and in-memory only — never on disk, never in a log
line, never in an `AgentEvent`. Outbound crawling respects `robots.txt`, sends a
truthful identifying user-agent, is rate-limited per host, and touches only the
origin the brand submitted.
