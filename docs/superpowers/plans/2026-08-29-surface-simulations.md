# Evidence-backed Surface Simulations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three scripted non-browser Check columns with one real ACP/UCP simulation, one real `/llms.txt` simulation, and one real blind Web-search simulation using the same product and shopper brief.

**Architecture:** The existing run coordinator selects one immutable product/brief context, launches three independent read-only workers, streams typed append-only surface events, and assembles one validated `CheckResult`. The frontend folds those events into three plain console feeds; the Browser column and all downstream Check content remain unchanged.

**Tech Stack:** Bun, Hono, TypeScript strict mode, Cloudflare AI Gateway REST, Anthropic Messages schema, Next.js 15 App Router, React 19, CSS Modules, Bun test.

**Spec:** `docs/superpowers/specs/2026-08-29-surface-simulations-design.md`

## Global Constraints

- No product category may appear in production code or production-read fixtures.
- No model call may decide protocol support, discovery, identity, rank, or score.
- Every model criticism must cite evidence IDs produced by the same run.
- No headless browser or state-changing commerce operation may be added.
- Every model call goes through `backend/src/llm.ts` and uses the Cloudflare REST endpoint required by `AGENTS.md`.
- Brand credentials must never be persisted, logged, streamed, or included in model evidence.
- The Browser `AgentEvent`, `LivestreamTile`, stage board, funnel, recommendations, and dashboard remain unchanged.
- CI tests use injected or recorded responses and make no network calls.
- If `CheckResult` needs a schema change, stop and revise `docs/superpowers/specs/2026-08-29-surface-simulation-json-contract-update.md` before changing shared report types.

## File structure

- `shared/contracts/surface-simulation.ts` — shared progress-event contract and runtime validator.
- `backend/src/surfaces/types.ts` — worker context, evidence sink, critique interfaces, and result types.
- `backend/src/surfaces/protocol.ts` — ACP/UCP fetch and deterministic document assessment.
- `backend/src/surfaces/guide.ts` — `/llms.txt` parsing, target coverage, and safe relevant-link selection.
- `backend/src/surfaces/critique.ts` — structured evidence-cited model critique and deterministic fallback.
- `backend/src/surfaces/search.ts` — one blind shopper search, event mapping, evidence, and deterministic match.
- `backend/src/surfaces/result.ts` — legacy catalogue/check adapter and validated one-query `CheckResult` assembly.
- `backend/src/surfaces/orchestrate.ts` — shared context selection and concurrent worker orchestration.
- `frontend/src/lib/surface-events.ts` — pure event reducer, per-panel derivations, timestamps, and JSON slices.
- `frontend/src/app/runs/[id]/check/SurfaceConsole.tsx` — console-only renderer for the three new panels.

---

### Task 1: Shared surface-event contract

**Files:**
- Create: `shared/contracts/surface-simulation.ts`
- Create: `backend/src/surfaces/surface-simulation.test.ts`

**Interfaces:**
- Produces: `SurfaceSimulationKey`, `SurfaceSimulationPhase`, `SurfaceSimulationEvent`, and `validateSurfaceSimulationEvent(value: unknown): string[]`.
- Consumed by: backend run storage/orchestration and frontend event folding.

- [ ] **Step 1: Write failing validator tests**

```ts
import { describe, expect, test } from "bun:test";
import { validateSurfaceSimulationEvent } from "@contracts/surface-simulation";

describe("validateSurfaceSimulationEvent", () => {
  test("accepts a real append-only progress event", () => {
    expect(validateSurfaceSimulationEvent({
      event_id: "surf_guide_0001",
      sequence: 1,
      surface: "model_readable_guide",
      phase: "fetch",
      at: "2026-08-29T10:25:03.114Z",
      message: "GET https://example.com/llms.txt returned HTTP 200",
      evidence_id: "ev_guide_fetch",
    })).toEqual([]);
  });

  test("rejects unknown surfaces, phases and malformed ordering fields", () => {
    const errors = validateSurfaceSimulationEvent({
      event_id: "",
      sequence: -1,
      surface: "browser",
      phase: "thinking",
      at: "not-a-date",
      message: "",
      evidence_id: "",
    });
    expect(errors).toContain("event_id must be non-empty");
    expect(errors).toContain("sequence must be a non-negative integer");
    expect(errors).toContain("surface is not supported");
    expect(errors).toContain("phase is not supported");
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `cd backend && bun test src/surfaces/surface-simulation.test.ts`

Expected: FAIL because `@contracts/surface-simulation` does not exist.

- [ ] **Step 3: Implement the shared discriminated values and validator**

```ts
export const SURFACE_SIMULATION_KEYS = [
  "agent_protocol",
  "model_readable_guide",
  "web_search",
] as const;

export const SURFACE_SIMULATION_PHASES = [
  "context", "fetch", "parse", "validate", "model", "match", "result",
] as const;

export interface SurfaceSimulationEvent {
  event_id: string;
  sequence: number;
  surface: (typeof SURFACE_SIMULATION_KEYS)[number];
  phase: (typeof SURFACE_SIMULATION_PHASES)[number];
  at: string;
  message: string;
  evidence_id: string | null;
}
```

Implement the dependency-free validator with exact enum membership, integer,
ISO timestamp, and nullable non-empty string checks. Do not accept arbitrary
strings or widen the event with `Record<string, unknown>`.

- [ ] **Step 4: Run contract tests and typechecks**

Run: `cd backend && bun test src/surfaces/surface-simulation.test.ts && bun run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add shared/contracts/surface-simulation.ts backend/src/surfaces/surface-simulation.test.ts
git commit -m "feat: define surface simulation events"
```

### Task 2: Deterministic protocol and guide analysis

**Files:**
- Create: `backend/src/surfaces/types.ts`
- Create: `backend/src/surfaces/protocol.ts`
- Create: `backend/src/surfaces/protocol.test.ts`
- Create: `backend/src/surfaces/guide.ts`
- Create: `backend/src/surfaces/guide.test.ts`

**Interfaces:**
- Consumes: `DocumentFetcher`, `FetchedDocument`, `TargetProduct`, and the shared surface-event type.
- Produces: `assessProtocolDocument(kind, document)`, `parseLlmsTxt(body, target)`, `selectRelevantGuideLinks(parsed, brief, origin, limit)`, `SurfaceWorkerContext`, and `SurfaceWorkerResult`.

- [ ] **Step 1: Write protocol assessment tests**

```ts
test("requires a UCP profile rather than treating any HTTP 200 as support", () => {
  const assessment = assessProtocolDocument("ucp", {
    url: "https://example.com/.well-known/ucp",
    status: 200,
    contentType: "application/json",
    durationMs: 4,
    body: JSON.stringify({ ucp: { version: "2026-04-08", services: {}, capabilities: {} } }),
  });
  expect(assessment.supported).toBe(true);
  expect(assessment.facts).toContain("UCP version 2026-04-08");
});

test("rejects an HTML soft 404 at the configured ACP path", () => {
  const assessment = assessProtocolDocument("acp", {
    url: "https://example.com/.well-known/agent-commerce",
    status: 200,
    contentType: "text/html",
    durationMs: 3,
    body: "<!doctype html><title>Not found</title>",
  });
  expect(assessment.supported).toBe(false);
  expect(assessment.reason).toBe("Unable to be found");
});
```

- [ ] **Step 2: Write guide parser tests**

```ts
test("parses the llms.txt title, sections, links and target coverage", () => {
  const parsed = parseLlmsTxt(
    "# Example Store\n\n> Agent guide\n\n## Catalogue\n- [Primary item](https://example.com/items/primary): Current offer",
    { name: "Primary item", canonical_url: "https://example.com/items/primary" },
  );
  expect(parsed.title).toBe("Example Store");
  expect(parsed.links).toHaveLength(1);
  expect(parsed.target_covered).toBe(true);
});

test("selects only relevant same-origin http links", () => {
  const selected = selectRelevantGuideLinks(parsedGuide, "fast delivery under budget", "https://example.com", 3);
  expect(selected.every((url) => new URL(url).origin === "https://example.com")).toBe(true);
  expect(selected.length).toBeLessThanOrEqual(3);
});
```

- [ ] **Step 3: Run both test files and verify RED**

Run: `cd backend && bun test src/surfaces/protocol.test.ts src/surfaces/guide.test.ts`

Expected: FAIL because the surface modules do not exist.

- [ ] **Step 4: Implement focused pure analyzers**

Use a strict `ProtocolAssessment` result:

```ts
export interface ProtocolAssessment {
  kind: "acp" | "ucp";
  found: boolean;
  supported: boolean;
  parsed: Record<string, unknown> | null;
  facts: string[];
  reason: string | null;
}
```

For UCP, require a JSON `ucp` object with a date-version string plus object
`services` and `capabilities`. For ACP, require non-HTML JSON and observable
commerce capability material such as `capabilities`, `services`, `endpoints`,
or `openapi`; report the configured path as a tested convention rather than a
universal ACP requirement. Keep parsing read-only.

Use a strict `ParsedLlmsTxt` result:

```ts
export interface ParsedLlmsTxt {
  title: string | null;
  summary: string | null;
  sections: { heading: string; links: GuideLink[] }[];
  links: GuideLink[];
  target_covered: boolean;
  facts: string[];
}
```

Extract Markdown links with their section and trailing note. Select links by
same-origin URL validity and token overlap with the runtime brief/target, capped
at three. Do not add category vocabulary.

- [ ] **Step 5: Run analyzer tests and backend typecheck**

Run: `cd backend && bun test src/surfaces/protocol.test.ts src/surfaces/guide.test.ts && bun run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```sh
git add backend/src/surfaces/types.ts backend/src/surfaces/protocol.ts backend/src/surfaces/protocol.test.ts backend/src/surfaces/guide.ts backend/src/surfaces/guide.test.ts
git commit -m "feat: analyze protocol and llms surfaces"
```

### Task 3: Evidence-cited model critiques through the required gateway

**Files:**
- Modify: `backend/src/llm.ts`
- Create: `backend/src/llm.test.ts`
- Create: `backend/src/surfaces/critique.ts`
- Create: `backend/src/surfaces/critique.test.ts`
- Modify: `backend/.env.example`

**Interfaces:**
- Consumes: `completeJson`, deterministic facts, bounded untrusted content, and available `Evidence` IDs.
- Produces: `SurfaceCritique`, `CritiquePoint`, `requestSurfaceCritique(input, client)`, `validateSurfaceCritique(value, allowedEvidenceIds)`, and `fallbackCritique(facts)`.

- [ ] **Step 1: Write the Cloudflare transport test**

Inject an HTTP transport into `completeJson` and assert that it posts to:

```ts
expect(request.url).toBe(
  "https://api.cloudflare.com/client/v4/accounts/account-1/ai/v1/messages",
);
expect(request.headers.get("authorization")).toBe("Bearer token-1");
expect(body.model).toBe("anthropic/claude-sonnet-4-5");
```

Also assert that neither the token nor authorization header appears in thrown
errors.

- [ ] **Step 2: Write critique validation and fallback tests**

```ts
test("rejects critique points that invent evidence", () => {
  const errors = validateSurfaceCritique({
    summary: "Readable but incomplete",
    strengths: [],
    gaps: [{ text: "No direct source", evidence_ids: ["ev_invented"] }],
    shopper_impact: [],
    improvements: [],
  }, new Set(["ev_guide_fetch"]));
  expect(errors).toContain('unknown evidence id "ev_invented"');
});

test("returns deterministic fallback after the retry also fails", async () => {
  const result = await requestSurfaceCritique(input, async () => invalidCritique);
  expect(result.source).toBe("fallback");
  expect(result.critique.summary).toContain("Critique unavailable");
});
```

- [ ] **Step 3: Run focused tests and verify RED**

Run: `cd backend && bun test src/llm.test.ts src/surfaces/critique.test.ts`

Expected: FAIL on the old gateway transport and missing critique module.

- [ ] **Step 4: Correct `backend/src/llm.ts` and implement critique parsing**

Change the one LLM entry point to the required Cloudflare URL and Bearer auth.
Keep the Anthropic Messages request body and provider-prefixed model ID. Allow
tests to inject environment/transport without exposing secrets.

Use this output schema:

```ts
const SURFACE_CRITIQUE_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    strengths: { type: "array", items: CRITIQUE_POINT_SCHEMA },
    gaps: { type: "array", items: CRITIQUE_POINT_SCHEMA },
    shopper_impact: { type: "array", items: CRITIQUE_POINT_SCHEMA },
    improvements: { type: "array", items: CRITIQUE_POINT_SCHEMA },
  },
  required: ["summary", "strengths", "gaps", "shopper_impact", "improvements"],
  additionalProperties: false,
};
```

Validate every cited ID, retry once with the validation errors and prior output,
then return factual fallback text. Never turn model prose into a score.

- [ ] **Step 5: Run focused and existing LLM tests**

Run: `cd backend && bun test src/llm.test.ts src/surfaces/critique.test.ts src/agents/cloudflare.test.ts && bun run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```sh
git add backend/src/llm.ts backend/src/llm.test.ts backend/src/surfaces/critique.ts backend/src/surfaces/critique.test.ts backend/.env.example
git commit -m "feat: add evidence-cited surface critiques"
```

### Task 4: One real simulation per method and one validated result

**Files:**
- Create: `backend/src/surfaces/protocol-worker.ts`
- Create: `backend/src/surfaces/guide-worker.ts`
- Create: `backend/src/surfaces/search.ts`
- Create: `backend/src/surfaces/search.test.ts`
- Create: `backend/src/surfaces/result.ts`
- Create: `backend/src/surfaces/result.test.ts`
- Create: `backend/src/surfaces/orchestrate.ts`
- Create: `backend/src/surfaces/orchestrate.test.ts`

**Interfaces:**
- Consumes: legacy `Catalogue`, `Checks`, generated briefs/personas, `OriginFetcher`, `SharedSearchAgent`, `matchProposal`, and the critique client.
- Produces: `runSurfaceSimulations(input, dependencies): Promise<CheckResult>` and three independent worker results.

- [ ] **Step 1: Write recorded Web-search tests**

Use an injected `ShopperAgent` async generator that emits a query, API call,
three citations, a same-origin fetch, and a verdict. Assert:

```ts
expect(result.run.query_id).toBe("q_surface_001");
expect(result.run.outcome.target_discovered).toBe(true);
expect(result.run.outcome.target_rank).toBe(3);
expect(result.events.map((event) => event.phase)).toEqual([
  "context", "model", "fetch", "fetch", "fetch", "fetch", "match", "result",
]);
```

Add failure cases for `AGENT_ERROR` and `AGENT_TIMEOUT`; both must return a
non-recommendation with a registered failure code.

- [ ] **Step 2: Write result-builder tests**

```ts
test("builds one valid report from the shared context", () => {
  const report = buildSurfaceCheckResult(input);
  expect(validateCheckResult(report)).toEqual([]);
  expect(report.evaluation_config.agent_count).toBe(1);
  expect(report.evaluation_config.queries).toEqual([
    { query_id: "q_surface_001", text: sharedBrief, intent: "product_discovery" },
  ]);
  expect(report.agent_runs).toHaveLength(1);
});
```

Assert protocol/guide probes occupy `site_audit`, Web search occupies
`agent_runs[0]`, scores agree with that run, and every event evidence reference
resolves in `evidence[]`.

- [ ] **Step 3: Write orchestration tests**

Inject three delayed workers and assert that all receive the same exact target
object and brief string, failure in one still lets the other two settle, and
event sequences are globally monotonic and unique.

- [ ] **Step 4: Run worker tests and verify RED**

Run: `cd backend && bun test src/surfaces/search.test.ts src/surfaces/result.test.ts src/surfaces/orchestrate.test.ts`

Expected: FAIL because the workers and result builder do not exist.

- [ ] **Step 5: Implement protocol and guide workers**

Each worker must:

```ts
emit(surface, "context", "Loaded shared product and shopper brief", null);
emit(surface, "fetch", fetchMessage, fetchEvidence.evidence_id);
emit(surface, "parse", parseMessage, extractionEvidence.evidence_id);
emit(surface, "validate", deterministicMessage, extractionEvidence.evidence_id);
emit(surface, "model", "Critiquing retrieved evidence", null);
emit(surface, "result", settledMessage, modelEvidence?.evidence_id ?? extractionEvidence.evidence_id);
```

Protocol fetches the configured ACP path and `/.well-known/ucp`. Guide fetches
`/llms.txt` and no more than three selected same-origin links. Missing documents
skip the model and settle with `Unable to be found`; fetch errors settle with
`Unable to verify`.

- [ ] **Step 6: Implement the blind search worker and report builder**

Map the existing search-agent events into surface events and `Evidence`. Call
`matchProposal()` only after citations and same-origin fetches are collected.
Construct one `AgentRun` and use `computeScores()` plus
`assertCheckResult()` when assembling the report.

Adapt legacy catalogue/check data without inventing facts:

```ts
const target: TargetProduct = {
  product_id: selectedSkuOrStableUrlId,
  name: product.title ?? new URL(product.url).pathname,
  canonical_url: product.url,
  gtin: null,
  sku: selectedSku,
  category: null,
  price: parseKnownPrice(product.price, currency),
};
```

- [ ] **Step 7: Run all surface tests and backend typecheck**

Run: `cd backend && bun test src/surfaces && bun run typecheck`

Expected: PASS.

- [ ] **Step 8: Commit**

```sh
git add backend/src/surfaces
git commit -m "feat: run three evidence-backed surface simulations"
```

### Task 5: Integrate surface events and results into the live run

**Files:**
- Modify: `backend/src/types.ts`
- Modify: `backend/src/store.ts`
- Create: `backend/src/store.test.ts`
- Modify: `backend/src/index.ts`
- Create: `backend/src/index.test.ts`

**Interfaces:**
- Consumes: `runSurfaceSimulations()` and the shared surface-event contract.
- Produces: replayable `surface_simulation` and `check_result` SSE messages; `Run.surfaceEvents`; `Run.checkResult`.

- [ ] **Step 1: Write run-store replay tests**

```ts
test("stores surface events and the final report for replay", () => {
  const run = createRun(input);
  publish(run, { type: "surface_simulation", event });
  publish(run, { type: "check_result", result: report });
  expect(run.surfaceEvents).toEqual([event]);
  expect(run.checkResult).toBe(report);
});
```

Assert duplicate `event_id` values are not stored twice.

- [ ] **Step 2: Write SSE integration tests**

Create a run with prior surface events/result, connect to
`GET /runs/:id/events`, and assert the stream replays surface events in
`sequence` order before `check_result` and `done`.

- [ ] **Step 3: Run integration tests and verify RED**

Run: `cd backend && bun test src/store.test.ts src/index.test.ts`

Expected: FAIL because the new stream messages are unsupported.

- [ ] **Step 4: Extend run state and stream replay**

Add:

```ts
surfaceEvents: SurfaceSimulationEvent[];
checkResult: CheckResult | null;
```

Extend `StreamMessage` with the two approved envelopes. Make `publish()` store
and deduplicate surface events and store the report. Replay them from the SSE
route before the terminal `done` event.

- [ ] **Step 5: Launch surfaces concurrently with Browser agents**

After checks and generated briefs exist, construct the shared surface
dependencies and run:

```ts
const [checkResult] = await Promise.all([
  runSurfaceSimulations(surfaceInput, surfaceDependencies),
  runPopulation(run, catalogue, checks, personas, briefs),
]);
publish(run, { type: "check_result", result: checkResult });
```

Keep existing findings and Browser completion logic in place. Surface worker
errors become degraded results; contract validation failure remains a run-level
error.

- [ ] **Step 6: Run store/index tests and full backend suite**

Run: `cd backend && bun test && bun run typecheck`

Expected: PASS with no network calls.

- [ ] **Step 7: Commit**

```sh
git add backend/src/types.ts backend/src/store.ts backend/src/store.test.ts backend/src/index.ts backend/src/index.test.ts
git commit -m "feat: stream surface simulation progress"
```

### Task 6: Replace the three scripted columns with live consoles

**Files:**
- Create: `frontend/src/lib/surface-events.ts`
- Create: `frontend/src/lib/surface-events.test.ts`
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/lib/run-context.tsx`
- Modify: `frontend/src/app/runs/[id]/check/surfaces.ts`
- Modify: `frontend/src/app/runs/[id]/check/SurfaceColumn.tsx`
- Modify: `frontend/src/app/runs/[id]/check/SurfaceColumn.module.css`
- Create: `frontend/src/app/runs/[id]/check/SurfaceConsole.tsx`
- Modify: `frontend/src/app/runs/[id]/check/page.tsx`
- Modify: `frontend/src/app/runs/[id]/check/check.module.css`

**Interfaces:**
- Consumes: shared `SurfaceSimulationEvent` and final `CheckResult` messages.
- Produces: `appendSurfaceEvent(current, incoming)`, `surfaceConsoleState(key, events, result)`, and three progressively growing console panels.

- [ ] **Step 1: Write reducer tests**

```ts
test("appends real events in sequence and suppresses replay duplicates", () => {
  const folded = [later, earlier, earlier].reduce(appendSurfaceEvent, []);
  expect(folded.map((event) => event.event_id)).toEqual([
    earlier.event_id,
    later.event_id,
  ]);
});

test("keeps each surface transcript isolated", () => {
  expect(surfaceEventsFor("web_search", mixed)).toEqual([searchEvent]);
  expect(surfaceEventsFor("agent_protocol", mixed)).toEqual([protocolEvent]);
});
```

Add tests for timestamp labels, waiting/running/settled progress, unavailable
copy, and protocol/guide/search JSON extraction from the final report.

- [ ] **Step 2: Run frontend tests and verify RED**

Run: `cd frontend && bun test src/lib/surface-events.test.ts`

Expected: FAIL because the reducer does not exist.

- [ ] **Step 3: Implement stream handling and run context state**

Extend `StreamMessage` with the shared event and `CheckResult`, register both
EventSource names, and store:

```ts
surfaceEvents: SurfaceSimulationEvent[];
checkResult: CheckResult | null;
```

Reset both on a new run. Fold incoming events through the pure deduplicating
reducer rather than appending blindly.

- [ ] **Step 4: Derive real surface states**

Delete the tick-generated protocol, guide, and search lines. `buildSurfaces()`
must receive the buffered surface events and final result; Browser state keeps
its existing agent-progress derivation. The new panels are always measured and
never show the `simulated` badge.

- [ ] **Step 5: Implement the plain console renderer**

Render one row per event:

```tsx
<div className={styles.line} key={event.event_id}>
  <time className={styles.time}>{surfaceTime(event.at, startedAt)}</time>
  <span className={styles.text}>{event.message}</span>
</div>
```

Use a dark background, white monospaced text, muted timestamps, and no
surface-specific text colors. Append content as state grows, auto-scroll only
when the user is already near the bottom, and preserve manual scrollback.
Render the relevant JSON fragment after the surface reaches `result`; render
one full-report disclosure only after `checkResult` arrives.

- [ ] **Step 6: Wire only the three requested columns**

Pass `SurfaceConsole` as children for protocol, guide, and search. Keep the
existing Browser `SurfaceColumn` children and `LivestreamTile` mapping exactly
as they are. Do not edit dashboard, recommendation, funnel, or stage-board
logic.

- [ ] **Step 7: Run frontend tests, typecheck, and build**

Run: `cd frontend && bun test && npm run typecheck && npm run build`

Expected: PASS.

- [ ] **Step 8: Commit**

```sh
git add frontend/src/lib/api.ts frontend/src/lib/run-context.tsx frontend/src/lib/surface-events.ts frontend/src/lib/surface-events.test.ts 'frontend/src/app/runs/[id]/check'
git commit -m "feat: show live surface simulation consoles"
```

### Task 7: Contract documentation and end-to-end verification

**Files:**
- Modify: `docs/superpowers/specs/2026-08-29-surface-simulation-json-contract-update.md`
- Modify: `docs/state-of-the-app.md`
- Modify: `backend/.env.example` if the verified runtime names differ from Task 3.

**Interfaces:**
- Consumes: the implemented shared event and stream message types.
- Produces: documentation that exactly matches shipped JSON and current runtime behavior.

- [ ] **Step 1: Compare shipped types with the contract-update document**

Run:

```sh
rg -n "SurfaceSimulationEvent|surface_simulation|check_result" shared backend/src frontend/src docs/superpowers/specs/2026-08-29-surface-simulation-json-contract-update.md
```

Expected: one shared event definition, matching producer/consumer envelopes,
and no duplicated widened frontend type.

- [ ] **Step 2: Update the contract note and state-of-app report with measured behavior**

Record the exact event fields, replay/deduplication behavior, fallback behavior,
and verification commands. Remove the old statement that Web search is
simulated only after the recorded integration test proves real search events
drive the panel.

- [ ] **Step 3: Run the complete verification suite**

Run:

```sh
cd backend && bun test && bun run typecheck
cd frontend && bun test && npm run typecheck && npm run build
```

Expected: every command exits 0.

- [ ] **Step 4: Run static hard-rule scans**

Run:

```sh
rg -n "gateway\.ai\.cloudflare\.com|compat/chat/completions" backend/src
rg -n "Authorization|Bearer|CLOUDFLARE.*TOKEN" backend/src/surfaces frontend/src
rg -n "simulated" 'frontend/src/app/runs/[id]/check'
```

Expected: no deprecated Cloudflare endpoint, no credential material in new
surface/frontend code, and no simulated badge or scripted surface output for
the three new panels.

- [ ] **Step 5: Inspect the rendered Check page**

Start backend and frontend with the documented commands. With configured
runtime credentials, submit a store and verify that each new console adds lines
only after real milestones, missing resources settle clearly, Web search is
brand-blind, the Browser tiles are unchanged, and the full JSON disclosure
appears after the three surfaces settle. If credentials are unavailable, replay
the recorded integration fixture through the same reducer and renderer.

- [ ] **Step 6: Commit**

```sh
git add docs/superpowers/specs/2026-08-29-surface-simulation-json-contract-update.md docs/state-of-the-app.md backend/.env.example
git commit -m "docs: record live surface simulation behavior"
```
