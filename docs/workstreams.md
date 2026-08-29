# Workstreams

Three people, three lanes, one shared contract. The point of this document is
that nobody waits on anybody after the first commit.

## The unblocking commit

Before anyone starts feature work, one commit lands:

1. `shared/contracts/` — the TypeScript types from `docs/data-contracts.md`,
   imported by both services.
2. `shared/fixtures/check-result.example.json` — a complete `CheckResult` with a
   mix of hits, a discovered-but-rejected run, a never-found run, a timeout,
   competitors, and a populated site audit.
3. `shared/fixtures/findings.example.json` — valid Evaluate output for it.

Landed in `de55c97` and its follow-up. Evaluate and the whole frontend can now be
built to completion without Check existing.

## Lanes

### Dev A — Check (Simulate)

**Owns:** `backend/src/catalogue/`, `personas/`, `agents/`, `audit/`, `score/`,
`runs/`

Catalogue snapshot, persona generation, both `ShopperAgent` implementations,
deterministic matching, the site audit, scoring, the job queue, and the event
bus. Produces `CheckResult` and the `AgentEvent` stream.

**Done when:** a run against an arbitrary store produces a valid `CheckResult`
that validates against the contract, and the event stream drives the live feed.

### Dev B — Evaluate

**Owns:** `backend/src/evaluate/`, `http/evaluate.ts`

Findings derivation from `CheckResult`, ranking by impact, the snippet each
finding carries, and conformance to `validate-findings.ts`.

**Works against `shared/fixtures/check-result.example.json` from day one.** Does
not need Check to exist.

**Done when:** the example `CheckResult` produces ranked findings that pass
`assertFindings` — every reference resolving, every failure code traced to the
runs that reported it, and a snippet on each.

### Dev C (project owner) — Frontend + shell

**Owns:** `frontend/`, `backend/src/http/runs.ts`, `events.ts`, `index.ts`,
`env.ts`, `demo/`

Wire the three routes to the real API, replace the fixture clock in
`run-context.tsx` with an SSE subscription, rewrite `simulation.ts` as a fold
over events, build the dashboard and analytics, BYOK settings, and `DEMO_MODE`.

**Works against the fixture and a stubbed SSE stream from day one.**

**Done when:** the three routes run off the backend, the live feed shows real
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
- emits a `Finding` that fails `validate-findings.ts`
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
| 3 | Persona generation; `SharedSearchAgent`; finding snippets; SSE wiring | 2 |
| 4 | Matching, scoring, site audit; live feed | 3 |
| 5 | `NativeSearchAgent` and BYOK; re-run loop; dashboard | 4 |
| 6 | `DEMO_MODE` recording of a real end-to-end run | 5 |

Step 6 is not optional. The demo is graded live and the network will not be
friendly.
