# Surface simulation JSON contract update

**Date:** 2026-08-29
**Status:** Implemented on `feature/surface-simulations`
**Related design:**
`docs/superpowers/specs/2026-08-29-surface-simulations-design.md`

## Why this document exists

The current frontend SSE union carries catalogue, persona, Browser session,
site-audit, Browser agent, finding, and completion messages. The three new
surface consoles need replayable progress that is distinct from the existing
six-stage Browser `AgentEvent`.

This document records the JSON change separately so parallel work can
deconflict against an explicit producer/consumer contract. It does not change
the approved `CheckResult` schema unless the implementation reaches the stop
condition described below.

## New shared type

The source of truth lives in
`shared/contracts/surface-simulation.ts`; backend and frontend import it rather
than defining local equivalents.

```ts
export type SurfaceSimulationKey =
  | "agent_protocol"
  | "model_readable_guide"
  | "web_search";

export type SurfaceSimulationPhase =
  | "context"
  | "fetch"
  | "parse"
  | "validate"
  | "model"
  | "match"
  | "result";

export interface SurfaceSimulationEvent {
  event_id: string;
  sequence: number;
  surface: SurfaceSimulationKey;
  phase: SurfaceSimulationPhase;
  at: string;
  message: string;
  evidence_id: string | null;
}
```

Wire keys are snake_case to match the shared report contracts. `sequence` is a
monotonic per-run ordering key. `event_id` is stable across replay and unique
within the run.

`message` is display text only. No scorer or evaluator parses it. Machine
decisions remain in deterministic facts and the final `CheckResult`.

## New SSE envelopes

Two messages are added to the existing stream:

```ts
type SurfaceSimulationStreamMessage = {
  type: "surface_simulation";
  event: SurfaceSimulationEvent;
};

type CheckResultStreamMessage = {
  type: "check_result";
  result: CheckResult;
};
```

Representative progress event:

```json
{
  "type": "surface_simulation",
  "event": {
    "event_id": "surf_0013",
    "sequence": 12,
    "surface": "model_readable_guide",
    "phase": "parse",
    "at": "2026-08-29T10:25:03.114Z",
    "message": "Parsed 6 links across 3 sections",
    "evidence_id": "ev_guide_assessment"
  }
}
```

The final-result envelope contains the complete `CheckResult` object without a
summary or mapping layer. Its concrete JSON shape remains the one in
`shared/fixtures/check-result.example.json`; the backend validates the full
object before placing it in `result`.

## Event semantics

- `context`: the immutable target and shopper brief were selected.
- `fetch`: a real read-only network request settled.
- `parse`: received content was structurally parsed.
- `validate`: deterministic rules produced an observed fact.
- `model`: a model call started, completed, retried, or fell back.
- `match`: deterministic URL/domain/product matching produced a fact.
- `result`: the individual surface settled.

Events are append-only. The backend assigns zero-based global sequence values,
stores each `event_id` once, and sorts replay by `sequence`. The frontend also
deduplicates by `event_id` before appending, making reconnect replay idempotent.
Neither side manufactures delayed lines for animation.

## Evidence linkage

`evidence_id` is null for lifecycle-only messages such as model-call start. It
is required when the message reports a durable observation that appears in the
final report. The referenced item must exist in `CheckResult.evidence[]` by the
time the `check_result` message is published.

Protocol and guide model critiques are serialized into `Evidence` entries with
`kind: "model_output"`. Their `excerpt` contains the bounded JSON form of
`SurfaceCritique`; their `summary` provides a short human-readable statement.
Web-search model output is recorded the same way alongside citations and
fetches.

## Existing contracts not changed

The existing Browser `AgentEvent` remains unchanged. Browser events continue to
use the current `type: "agent"` envelope and existing camelCase fields. No
consumer must reinterpret a Browser event as a surface event.

The final report remains schema version `1.1.0` and uses the existing
homes:

- `site_audit.agent_commerce`
- `site_audit.ucp`
- `site_audit.llms_txt`
- `evaluation_config.queries[0]`
- `agent_runs[0]` for Web search
- `evidence[]` for all cited observations and model output

## Producer and consumers

**Producer:** the backend run coordinator and the three surface workers.

**Consumers:**

- frontend run context buffers and deduplicates events;
- the three Check-screen console panels filter by `surface`;
- the full-report disclosure stores the `check_result` payload; and
- Evaluate continues to consume only `CheckResult`, not progress events.

## Validation

The event contract has a dependency-free runtime validator covering:

- known surface and phase values;
- non-empty `event_id` (uniqueness is enforced by the run store);
- non-negative integer `sequence`;
- valid ISO timestamp;
- non-empty display message; and
- nullable non-empty `evidence_id`.

Before publishing `check_result`, the report builder calls
`assertCheckResult()`. Focused tests cover report validity, deterministic score
agreement, run-store deduplication, ordered SSE replay, and frontend replay
deduplication.

## Compatibility

Adding new SSE event names is additive. Existing EventSource clients do not
listen for them and continue working. The Browser `AgentEvent` and existing
`CheckResult` fields do not change.

Frontend and backend land together. Their SSE envelope unions remain local to
each service, while the event payload and `CheckResult` are imported from shared
code so payload drift becomes a type error.

## Stop condition for a `CheckResult` change

This stop condition was not reached: serialized `model_output` evidence
represents each critique without changing `CheckResult` schema version `1.1.0`.

If a future implementation finds that serialized `model_output` evidence
cannot represent a critique without ambiguous ownership or unsafe parsing,
implementation stops before changing the report type. This document must then
be revised to propose explicit fields, followed by approval and the required
coordinated update to:

1. `shared/contracts/`;
2. `shared/contracts/validate.ts`;
3. `shared/fixtures/check-result.example.json`; and
4. `docs/data-contracts.md`.

The schema version is bumped according to the existing compatibility rules.
No local type widening is permitted as a shortcut.
