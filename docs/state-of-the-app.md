# State of the app

Measured on `feature/surface-simulations` on 2026-08-29. This report separates
behavior verified by recorded tests from behavior that still requires runtime
credentials and a public store.

## What works now

- The legacy catalogue crawl, site audit, Browser population, findings, and SSE
  flow remain connected to `backend/src/index.ts`.
- Check launches three additional read-only simulations against one selected
  product and one enabled shopper brief while the Browser population runs.
- Agent protocol fetches the configured ACP convention (default
  `/.well-known/agent-commerce`) and `/.well-known/ucp`. HTTP 200 alone is not
  treated as support: HTML soft-404s, malformed JSON, and incomplete UCP
  profiles settle as unavailable or unsupported. UCP declarations are checked
  for dated versions, HTTPS specification/schema URLs, and valid transports;
  ACP convention documents are evaluated against the pinned 2026-04-17
  snapshot and must contain versioned endpoint material or a complete OpenAPI
  document with callable operations.
- Model-readable guide fetches `/llms.txt`, parses its title, summary, sections,
  links, and direct target coverage, then follows at most three relevant
  same-origin HTTP links for content assessment. Missing files display “Unable
  to be found”; retrieval failures display “Unable to verify.” Structural facts
  include H1 count, summary, section/link counts, target coverage, duplicates,
  unsafe or off-origin links, and followed-link HTTP failures.
- Web search runs one shared-search shopper brief without adding the audited
  brand, domain, or canonical URL to that brief. Citations and fetched pages are
  matched to the target deterministically; model output never decides discovery,
  identity, rank, recommendation, or score.
- When `OPENAI_API_KEY` is configured, all three methods use the OpenAI
  Responses API directly. Protocol and guide receive bounded model-generated
  critiques whose points must cite evidence IDs from the same run; Web search
  uses the hosted `web_search` tool, then a separate structured ranking call.
  Invalid critiques retry once, then fall back without killing the run.
- Surface progress uses the shared append-only `SurfaceSimulationEvent`. The run
  store deduplicates and replays events in sequence order; the frontend performs
  a second idempotent fold for reconnects.
- Surface workers are independently capped at 45 seconds, inherit cancellation,
  retry transient retrieval/model failures once, and suppress late events after
  settlement. The origin fetcher enforces a 1 MB response cap before evidence
  excerpts are produced. SSE subscribes before taking its replay snapshot, so
  events published during replay are queued rather than lost.
- Sitemap absence is asserted only after complete exact-URL membership
  observation. Failed, truncated, nested, or deliberately bounded sitemap
  indexes remain unknown instead of being reported as missing.
- Check renders the three new methods as plain dark consoles with white text.
  Lines appear only when backend milestones happen. Each settled console can
  disclose its relevant report slice, and the page can disclose the complete
  consolidated `CheckResult`.
- The consolidated report keeps schema `1.1.0`: protocol and guide results live
  in `site_audit`, the single Web-search run lives in `agent_runs[0]`, and fetch,
  extraction, search, and critique evidence lives in `evidence[]`.

## Verification snapshot

Recorded tests make no network calls.

```text
backend:  176 tests passed, 0 failed; tsc --noEmit passed
frontend:  12 tests passed, 0 failed; tsc --noEmit passed
frontend:  next build completed successfully
```

The surface provider is selected in `index.ts`; existing persona generation and
written findings remain on Cloudflare. The direct OpenAI key stays server-side
and is never included in events, evidence, reports, or error messages.

## Runtime requirements and graceful degradation

The three additional surface simulations use:

```text
POST https://api.openai.com/v1/responses
Authorization: Bearer <OPENAI_API_KEY>
```

Their model defaults to `gpt-5-mini` and can be changed with
`HAPPY2_OPENAI_MODEL`. If credentials are missing or a model call fails,
protocol/guide HTTP evidence still runs, critiques fall back, and Web search
records `AGENT_ERROR` rather than aborting the overall run. Other model-backed
workflows retain their existing Cloudflare configuration.

A credential-safe direct structured-output call and hosted Web-search call were
verified with `gpt-5-mini`; the search-plus-ranking path returned ten bounded
citations and one candidate in 16.3 seconds. No full public-store run is claimed.

## Known limitations that remain

1. The existing Browser population still mixes real Browserbase sessions with
   scripted agents according to account quota. This change deliberately leaves
   `LivestreamTile`, Browser `AgentEvent`, stage board, funnel, recommendations,
   and dashboard behavior untouched.
2. Prototype Browser tile clips and stage captions remain in the legacy UI.
3. `POST /runs/:id/evaluate` remains API-only; the Recommend screen still uses
   findings from the legacy SSE lane.
4. Runs are stored in memory. Restarting the backend loses run history, and no
   re-run or hosted-artifact loop exists yet.
5. `CheckResult` is published for the new three-method assessment, but the
   Evaluate endpoint is not automatically invoked with it.

## Live endpoints

```text
GET  /health
POST /runs
GET  /runs/:id
GET  /runs/:id/events      SSE, including surface_simulation and check_result
POST /runs/:id/evaluate
```

## Remaining dark modules

```text
src/agents/native-client.ts
src/agents/native-search.ts
src/env.ts
src/fixtures.ts
src/models/anthropic.ts
src/runs/orchestrator.ts
src/runs/queue.ts
src/runs/services.ts
```
