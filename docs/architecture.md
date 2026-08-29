# Architecture

Two services, one repo, no external infrastructure.

```
frontend/   Next.js 15 App Router, TypeScript, CSS Modules      :3200
backend/    Bun + Hono, TypeScript, Postgres / bun:sqlite       :3201
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
    store.ts              in-memory runs + the per-run event bus
    persistence/db.ts     one query interface over Postgres and bun:sqlite
    persistence/runs.ts   saved runs — one JSON document per run
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
    shared-search.ts      Cloudflare AI Gateway + Anthropic web_search
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

Postgres when `DATABASE_URL` is set, `bun:sqlite` otherwise. One code path
either way: `persistence/db.ts` holds both engines to a single SQL subset
(TEXT/INTEGER columns, `$1` placeholders, `ON CONFLICT ... DO UPDATE`), so the
stores above it never branch on engine.

Two tables, each one JSON document per run beside the columns the list views
need:

| Table | Written | Holds |
| --- | --- | --- |
| `runs` | once, when a run stops | the whole `Run`, plus `store_url`, `status`, `created_at`, `findings`, `blocked` |
| `findings` | on `POST /runs/:id/evaluate` | Evaluate's output; re-evaluation replaces the row |

A live run stays in memory and streams over SSE; the database is what a run
becomes once it is over. `GET /runs/:id` reads memory first and falls back to
`runs`, so a reloaded run rehydrates every existing screen unchanged — with its
Browserbase sessions dropped, because a stopped session's live view is dead.

Deployed, this is a **free** Render Postgres, which Render deletes 30 days
after creation unless it is upgraded. See the note in `render.yaml`.

Not yet: per-event rows. Events are replayed from the run document rather than
an append-only table, so SSE reconnect is still not lossless.

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
