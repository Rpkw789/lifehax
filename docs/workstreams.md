# Workstreams

Three people, three lanes, one shared contract. The point of this document is
that nobody waits on anybody after the first commit.

## The unblocking commit

Before anyone starts feature work, one commit lands:

1. `shared/contracts/` — the TypeScript types from `docs/data-contracts.md`,
   imported by both services.
2. `shared/fixtures/check-result.example.json` — a realistic, complete
   `CheckResult` with ~20 shoppers, a mix of hits and misses, competitors, and a
   populated site audit.

After that commit, Evaluate, Create, and the whole frontend can be built to
completion without Check existing.

## Lanes

### Dev A — Check (Simulate)

**Owns:** `backend/src/catalogue/`, `personas/`, `agents/`, `audit/`, `score/`,
`runs/`

Catalogue snapshot, persona generation, both `ShopperAgent` implementations,
deterministic matching, the site audit, scoring, the job queue, and the event
bus. Produces `CheckResult` and the `AgentEvent` stream.

**Done when:** a run against an arbitrary store produces a valid `CheckResult`
that validates against the contract, and the event stream drives the live feed.

### Dev B — Evaluate + Create

**Owns:** `backend/src/evaluate/`, `create/`, `http/hosted.ts`

Findings derivation from `CheckResult`, ranking by impact, the `derivedFrom`
validation, artifact generation (`llms.txt`, agent feed, JSON-LD), and hosted
serving.

**Works against the fixture from day one.** Does not need Check to exist.

**Done when:** the fixture produces ranked findings that each cite real shopper
ids, artifacts generate for all three channels, and hosted URLs serve them.

### Dev C (project owner) — Frontend + shell

**Owns:** `frontend/`, `backend/src/http/runs.ts`, `events.ts`, `index.ts`,
`env.ts`, `demo/`

Wire the four existing routes to the real API, replace the fixture clock in
`run-context.tsx` with an SSE subscription, rewrite `simulation.ts` as a fold
over events, build the dashboard and analytics, BYOK settings, and `DEMO_MODE`.

**Works against the fixture and a stubbed SSE stream from day one.**

**Done when:** the four routes run off the backend, the live feed shows real
agent activity, and the dashboard reads `RunScores`.

## Rules for working in parallel

**Stay in your lane's directories.** A change outside them is either a contract
change or a conversation.

**Contract changes are never unilateral.** Propose it, get agreement, then update
`docs/data-contracts.md`, `shared/contracts/`, and the fixture in one commit. Do
not widen a type locally to unblock yourself — that breaks the other two lanes
silently.

**The fixture is production-shaped.** If your lane needs a field the fixture
lacks, that is a contract change, not a fixture edit.

**Branch per lane, small PRs.** `check/*`, `evaluate/*`, `frontend/*`. Rebase on
`main` before opening.

## Review checklist

Reject a change that:

- names a product category anywhere in source
- puts a model call in the scoring path
- emits a `Finding` with an empty `derivedFrom`
- adds a headless-browser dependency
- logs, persists, or serialises a brand's API key
- widens a shared contract without updating the doc and fixture

Reasoning for each is in `AGENTS.md` and the design spec.

## Verification

Before saying a piece is done, run it and paste the output. Failing tests get
reported as failing. A skipped step gets called out. This matters more than usual
here because three people are building against each other's unfinished work, and
an optimistic "should be fine" costs someone else an afternoon.

## Build order

| Order | Work | Blocked by |
| --- | --- | --- |
| 1 | Contract + fixture commit | — |
| 2 | Catalogue snapshot; findings from fixture; frontend wired to fixture | 1 |
| 3 | Persona generation; `SharedSearchAgent`; artifact generation; SSE wiring | 2 |
| 4 | Matching, scoring, site audit; hosted serving; live feed | 3 |
| 5 | `NativeSearchAgent` and BYOK; re-run loop; dashboard | 4 |
| 6 | `DEMO_MODE` recording of a real end-to-end run | 5 |

Step 6 is not optional. The demo is graded live and the network will not be
friendly.
