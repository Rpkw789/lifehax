# Data contracts

**The source of truth is `shared/contracts/`, not this document.** Types are
defined once in TypeScript and imported by both services, so a mismatch is a
compile error rather than a 3am integration surprise. This file explains the
shape and the rules around changing it.

| File | Contains |
| --- | --- |
| `shared/contracts/check-result.ts` | `CheckResult` and everything under it |
| `shared/contracts/codes.ts` | `FAILURE_CODES`, `REASON_CODES`, the `CodedFinding` shape |
| `shared/contracts/validate.ts` | `validateCheckResult` / `assertCheckResult` |
| `shared/fixtures/check-result.example.json` | A complete, valid example run |

Wire format is **snake_case**; the TypeScript interfaces mirror it exactly, so
there is no mapping layer to drift.

## What `CheckResult` is

The complete output of a Check (Simulate) run, and the only input Evaluate
needs. Its top level:

```
brand               who is being measured
target_product      the single product this run is about
catalogue_snapshot  what we could read from the store, and what we could not
site_audit          store-level facts, checked once (llms.txt, sitemap, /.well-known)
evaluation_config   locale, channels, and the generated queries
agent_runs[]        one per query — the journey, outcome, ranked candidates
evidence[]          everything the runs cite by evidence_id
scores              aggregates derived from agent_runs
hosted_sources      Create artifacts reachable this run (empty on a first run)
baseline_report_id  the run this one is compared against, if any
```

## The distinctions that matter

**Discovered vs. recommended.** `outcome.target_discovered` means our domain
surfaced at all; `outcome.target_recommended` means the agent actually put it
forward. These are different failures with opposite fixes — a discoverability
problem versus a persuasion problem — and separating them is the single most
diagnostic thing in this document. `our_pages_fetched` sharpens it further: an
agent that read our page and still declined tells you something an agent that
never found us cannot.

**Codes, not prose.** Failure and reason codes are enumerated, so Evaluate
groups and ranks them deterministically instead of parsing sentences.

**Codes are category-agnostic.** `MISSING_WATERPROOF_EVIDENCE` would make the
codebase know about footwear and break the generalisability the project is
graded on. Product specifics go in the `attribute` field:

```json
{ "code": "MISSING_ATTRIBUTE_EVIDENCE", "attribute": "waterproof" }
```

The validator rejects an attribute-scoped code with no `attribute`, and rejects
any code outside the registry — so this rule enforces itself.

**Store-level vs. run-level facts.** "No `llms.txt`" is a property of the store,
checked once, and lives in `site_audit`. "The agent could not find a price" is a
property of one run and lives in `observations`. Putting a store-level fact in a
run makes it look like twenty findings instead of one.

**Scores are derived, never asserted.** `hit_rate` and `discovery_rate` are
recomputed from `agent_runs` during validation and must agree to within 0.001.

## Validation

Check calls `assertCheckResult` before writing; Evaluate calls it on read.

```ts
import { assertCheckResult } from "../../shared/contracts/validate";

const doc = JSON.parse(raw);
assertCheckResult(doc);   // throws with every violation listed
```

Beyond structure, it enforces the invariants that actually catch integration
bugs: a recommendation with no rank, a rank with no recommendation, `top_3`
disagreeing with `target_rank`, an identity match without discovery, duplicate
candidate ranks, a target candidate whose rank contradicts the outcome, dangling
`evidence_id`s, unknown codes, attribute-scoped codes with no attribute,
non-recommendations carrying no failure code, and scores that disagree with the
runs they summarise.

Verified against the fixture: the example validates clean, and seven
representative drifts — including a renamed field, a category-specific code, and
a fabricated score — are all rejected with the path and reason.

## Changing the contract

A contract change is a cross-team change. Update **all four** in one commit:

1. `shared/contracts/` — the type
2. `shared/contracts/validate.ts` — the invariant, if the change has one
3. `shared/fixtures/check-result.example.json` — so the fixture stays valid
4. this document, if the change alters a rule rather than just a field

Bump `SCHEMA_VERSION`: patch for an added optional field, minor for an added
required one, **major for a rename or removal** — the validator refuses a
document whose major version differs from the contract's.

Never widen a type locally to unblock yourself. That is how two people ship
against different schemas and find out during the demo.

## Evaluate's output: `Finding`

Evaluate consumes `CheckResult` and emits `Finding[]`. The shape lives in
`frontend/src/lib/types.ts` and moves into `shared/contracts/` with one addition:

```ts
/** Evidence ids and agent_run ids this finding was derived from. Non-empty. */
derived_from: string[];
```

This is the machine-checkable form of the evidence rule. A finding with an empty
`derived_from` is generic advice, fails validation, and must not be emitted.

## HTTP surface

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/runs` | Create a run; returns `{ run_id }` |
| `GET` | `/runs/:id` | The run resource, including `CheckResult` when complete |
| `GET` | `/runs/:id/events` | SSE live feed; supports `Last-Event-ID` |
| `POST` | `/runs/:id/evaluate` | Produce `Finding[]` from the run's `CheckResult` |
| `POST` | `/runs/:id/create` | Generate artifacts; returns hosted URLs |
| `GET` | `/hosted/:brandId/*` | Serve generated artifacts to agents and brands |
| `GET` | `/health` | Liveness |

Errors are `{ "error": { "code", "message" } }` with the class carried by the
HTTP status. Never a 200 with an error body.

## Live feed events

The SSE stream is a separate, smaller contract and is defined alongside the
event bus when that lands. It carries no credentials: an API-call event records
the endpoint and its latency, never headers or keys.
