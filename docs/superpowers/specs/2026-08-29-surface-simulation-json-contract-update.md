# Surface simulation JSON contract update

**Date:** 2026-08-29
**Status:** Approved proposal, pre-implementation
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

The source of truth will live in a focused shared contract file rather than
duplicated backend/frontend types.

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
    "event_id": "surf_guide_0004",
    "sequence": 12,
    "surface": "model_readable_guide",
    "phase": "parse",
    "at": "2026-08-29T10:25:03.114Z",
    "message": "Parsed one title, three link sections and six links",
    "evidence_id": "ev_guide_parse_01"
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

Events are append-only. They are stored on the in-memory run and replayed in
`sequence` order. The frontend deduplicates by `event_id` before appending.
Neither the backend nor frontend manufactures delayed lines for animation.

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

The planned final report remains schema version `1.1.0` and uses the existing
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

The new event contract receives a dependency-free runtime validator covering:

- known surface and phase values;
- non-empty unique `event_id`;
- non-negative integer `sequence`;
- valid ISO timestamp;
- non-empty safe display message; and
- nullable non-empty `evidence_id`.

Before publishing `check_result`, the backend calls `assertCheckResult()`. A
test also verifies that every non-null surface-event evidence reference resolves
in the completed result.

## Compatibility

Adding new SSE event names is additive. Existing EventSource clients do not
listen for them and continue working. The Browser `AgentEvent` and existing
`CheckResult` fields do not change.

Frontend and backend land together because the current stream union is copied
between them. The new surface-event type itself is imported from shared code so
future drift becomes a type error.

## Stop condition for a `CheckResult` change

If serialized `model_output` evidence cannot represent a critique without
ambiguous ownership or unsafe parsing, implementation stops before changing the
report type. This document must then be revised to propose explicit fields,
followed by approval and the required coordinated update to:

1. `shared/contracts/`;
2. `shared/contracts/validate.ts`;
3. `shared/fixtures/check-result.example.json`; and
4. `docs/data-contracts.md`.

The schema version is bumped according to the existing compatibility rules.
No local type widening is permitted as a shortcut.
