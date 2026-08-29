# Architecture

Two services, one repo, no external infrastructure.

```
frontend/   Next.js 15 App Router, TypeScript, CSS Modules      :3200
backend/    Bun + Hono, TypeScript, Postgres / bun:sqlite       :3201
```

No Redis, no external worker, no container orchestration. Added complexity has
to earn its place against a hackathon timeline.

This file explains *why* the pieces are shaped the way they are.
**`docs/diagrams.md` draws where they sit**, and `docs/state-of-the-app.md`
records what is verified to work right now.

## Browsers, and what hard rule 5 actually forbids

The backend does drive real browsers: `@browserbasehq/stagehand` against
Browserbase, three of them per API key. That is not a contradiction of hard
rule 5 in `AGENTS.md`, but the rule is easy to misread, so state it precisely:

> **Evidence comes from `fetch`. Never from a browser session.**

`checks.ts` is the measurement — plain `fetch` plus regex, no browser and no
model, about three seconds, free. Every finding traces to it. The browser
population is the *visual*: it shows a shopper's journey stalling on a real
storefront, and its stage outcomes drive the attrition chart, but no finding
is derived from what a browser saw. Retrieval for scoring is search plus
`fetch`. Adding Playwright or Puppeteer to the evidence path is still a bug.

## Flow

`POST /runs` returns a run id immediately; `orchestrate()` keeps running after
the response and publishes to the run's event bus, which is the only thing the
frontend reads.

```
                POST /runs ──▶ 201 { runId }
                    │
                    ▼
            ┌───────────────┐
            │ snapshot      │  robots · sitemap · product feed · JSON-LD
            │ catalogue.ts  │  no products and no sitemap ⇒ finish(error)
            └───────┬───────┘
                    ▼
            ┌───────────────┐
            │ generatePer-  │  1 model call → 5 archetypes × 2 briefs
            │ sonas         │  archetypes are constants, briefs are generated
            └───────┬───────┘  per-store overrides win over the generator
                    ▼
            ┌───────────────┐
            │ runChecks     │  llms.txt · /.well-known · sitemap · robots
            │ checks.ts     │  JSON-LD and Offer coverage, client-side price
            └───────┬───────┘  ── the evidence ──
                    ▼
     ┌──────────────┴───────────────┐   Promise.all
     ▼                              ▼
┌──────────────────┐   ┌──────────────────────────────┐
│ runPopulation    │   │ runSurfaceSimulations        │
│ agents.ts        │   │ surfaces/                    │
│ 10 tiles:        │   │ agent protocol · llms.txt    │
│ 3 real browsers  │   │ guide · web search           │
│ 7 scripted       │   │ 45s cap each, retry once     │
└────────┬─────────┘   └───────────────┬──────────────┘
         │ AgentEvent                  │ SurfaceSimulationEvent
         │                             │ + one CheckResult
         └──────────────┬──────────────┘
                        ▼
            ┌───────────────────────┐
            │ computeSurfaces       │  arithmetic over the probes
            │ deriveFindings        │  model call, falling back to
            │ findings.ts           │  ruleFindings — never empty
            └───────────┬───────────┘
                        ▼
              finish() ──▶ runsStore.save()  ──▶ Postgres / bun:sqlite
                        │
                        └──▶ event bus ──▶ SSE ──▶ Check · Recommend · Dashboard
```

`POST /runs/:id/evaluate` is a separate lane: contract-driven rules over a
posted `CheckResult`, independent of the SSE run above. It works and is tested;
no screen calls it.

## Backend modules

The live path is what `index.ts` imports. An import walk from `index.ts`
reaches **56 of 66 non-test modules**; re-run the walk rather than trusting a
number in a document.

```
backend/src/
  index.ts              Hono app, CORS, error handler, every route, orchestrate()
  http.ts               fetch helpers, JSON-LD block parsing, URL resolution
  store.ts              in-memory runs, StreamMessage union, per-run event bus
  types.ts              Run, AgentEvent, Finding, Checks, Persona
  log.ts                levelled logger with per-run children
  llm.ts                the one model entry point

  catalogue.ts          snapshot(): robots, sitemap, feed, product extraction
  checks.ts             the site audit — fetch and regex, no browser, no model
  personas.ts           archetypes + generated briefs
  agents.ts             runPopulation(): Browserbase/Stagehand tiles
  findings.ts           computeSurfaces(), deriveFindings(), ruleFindings()

  surfaces/             the three read-only surface simulations
    orchestrate.ts        runs the workers, caps them, emits events
    protocol.ts           ACP convention and UCP profile analysis
    protocol-worker.ts    the protocol simulation
    guide.ts              llms.txt parsing and linked-source assessment
    guide-worker.ts       the guide simulation
    search.ts             one shared-search shopper brief, deterministic match
    critique.ts           bounded, evidence-citing model critique
    result.ts             assembles the consolidated CheckResult
    openai.ts             OpenAI-only services, absent without OPENAI_API_KEY

  catalogue/            fetch, extraction and origin safety used by surfaces/
  audit/, score/        probe and score arithmetic
  personas/             archetypes and PersonaBrief generation
  evaluate/             the Evaluate lane: rules, rank, snippets, api, store
  persistence/          db.ts (Postgres or bun:sqlite), runs.ts, personas.ts
  models/openai.ts      direct Responses transport and structured outputs
  runs/retry.ts         withTimeout and single-retry helpers
```

Not reached from `index.ts` — 10 modules, 815 lines:

```
agents/cloudflare.ts     agents/native-client.ts   agents/native-search.ts
agents/shared-search.ts  env.ts                    fixtures.ts
models/anthropic.ts      runs/orchestrator.ts      runs/queue.ts
runs/services.ts
```

This is the residue of an earlier "two of everything" split — a second agent
stack plus two config modules the flat files duplicate. The surfaces work
pulled `catalogue/`, `audit/`, `score/`, `personas/` and `evaluate/` into the
live path, which is why the list is now short rather than half the backend.
Either finish wiring `runs/orchestrator.ts` in or delete it; carrying both is
how a hackathon codebase doubles in a day.

## Two event shapes, deliberately

There are two `AgentEvent`s in this repo and they do not agree. That is
intentional and `backend/src/types.ts` says so at the top.

**The journey event** — what the browser population streams, and what the
Check tiles and the attrition chart read:

```ts
interface AgentEvent {
  t: number;           // tick; elapsed seconds = t * 0.14
  agentId: string;     // A01..A10
  stage: StageNumber;  // 1..6
  kind: "pass" | "fail";
  reason?: string;
}
```

Six stages, in order: `discover`, `land`, `read`, `select`, `cart`, `checkout`.
A stage is where a shopper stopped, so the funnel is a real measurement of the
three live agents even though the other seven are scripted.

**The search event** in `docs/data-contracts.md` is the contract shape —
query, fetch, citation, verdict — and is what `surfaces/` and the `CheckResult`
speak. The surfaces lane emits `SurfaceSimulationEvent` from
`shared/contracts/surface-simulation.ts`: append-only, sequence-ordered, each
line optionally citing an `evidence_id`.

## Live feed

`frontend/src/lib/simulation.ts` folds the streamed `AgentEvent`s into
`AgentState`. It used to derive everything from a fixture `PLAN` and a clock;
it does not any more, and the `AgentState` shape did not have to change.

What is left in `frontend/src/lib/fixtures.ts` is decoration — clip filenames,
ring positions, stage captions. It gets replaced, not extended.

The stream is idempotent in both directions. The backend replays everything
that already happened when a client connects, and it subscribes *before*
taking the replay snapshot so events published mid-replay are queued rather
than lost. On the client, `appendSurfaceEvent` de-duplicates by `event_id`. A
refresh mid-run loses nothing except live browser views, whose sessions are
dead once the run stops.

## Persistence

Postgres when `DATABASE_URL` is set, `bun:sqlite` otherwise. One code path
either way: `persistence/db.ts` holds both engines to a single SQL subset
(TEXT/INTEGER columns, `$1` placeholders, `ON CONFLICT ... DO UPDATE`), so the
stores above it never branch on engine.

| Table | Written | Holds |
| --- | --- | --- |
| `runs` | once, when a run stops | the whole `Run`, plus `store_url`, `status`, `created_at`, `findings`, `blocked` |
| `findings` | on `POST /runs/:id/evaluate` | Evaluate's output; re-evaluation replaces the row |
| persona overrides | on `PUT /stores/:host/personas` | per-store brief edits, keyed by host |

A live run stays in memory and streams over SSE; the database is what a run
becomes once it is over. The two are reached by different routes, and this is
the part worth remembering:

- **`GET /runs/:id/events` is memory-only.** It 404s for a saved run, because
  there is no per-event table to replay from.
- **`GET /runs/:id` reads memory first and falls back to `runs`.** It is the
  only way to open a finished run, and `frontend/src/lib/hydrate.ts` maps that
  document onto provider state in one step — pure, so its edge cases are
  tested without a fetch or a browser. A run that turns out to still be in
  flight is then followed on the stream as well.

Restored runs come back with their Browserbase sessions dropped: a live view
URL outlives its session by nothing, so showing one would render Browserbase's
"debugging connection was closed" page instead of a video.

Persona edits are filed against the **store**, not the run. A finished run's
personas are the record of what was measured and never change, so an edit made
while looking at one is an instruction for the next one.

Deployed, this is a **free** Render Postgres, which Render deletes 30 days
after creation unless it is upgraded. See the note in `render.yaml`.

Not yet: per-event rows. Events are replayed from the run document rather than
an append-only table, so SSE reconnect is not lossless across a restart.

## Failure behaviour

| Failure | Result |
| --- | --- |
| One shopper errors or times out | recorded as a non-hit with the error as `reason`; run continues |
| A surface worker exceeds 45s | that surface settles as blocked; the other two and the population continue |
| A surface critique comes back invalid | retried once, then dropped; the deterministic result stands |
| Model call for findings fails | falls back to `ruleFindings`, so Recommend is never empty |
| Store URL yields no products and no sitemap | run moves to `error` before any agent runs |
| Run exceeds wall-clock budget | completes with the results it has |

The distinction is whether the run still means something. A run with nine of
ten tiles does. A run with no catalogue does not.

## Security

Brand keys are request-scoped and in-memory only — never on disk, never in a
log line, never in an `AgentEvent`, evidence item, report, or error message.
`OPENAI_API_KEY` stays server-side; the frontend service holds no secrets at
all, because Render turns every env var into a build arg and Next inlines
`NEXT_PUBLIC_*` into the client bundle.

Outbound crawling respects `robots.txt`, sends a truthful identifying
user-agent, is rate-limited per host, and touches only the origin the brand
submitted. `catalogue/security.ts` resolves hosts before fetching so a
submitted URL cannot be pointed at internal addresses, and the origin fetcher
caps responses at 1 MB before evidence excerpts are produced.
