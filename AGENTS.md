# Working agreement

Instructions for AI coding assistants (Claude Code, Cursor, Codex, and others)
and for humans skimming for conventions. Read this before touching code.

## What this project is

Happy2 helps brands become discoverable to AI shopping agents. A brand submits
their store; we run ~20 generated shopper agents that search the web the way
ChatGPT or a shopping assistant would; we measure whether the brand's products
surface and where they rank; we diagnose why they didn't; we generate the fix and
host it so the next run can prove the fix worked.

Read `SPEC.md` for the product, `docs/architecture.md` for the system, and
`docs/superpowers/specs/2026-08-29-happy2-design.md` for why each decision was
made. Do not re-litigate a decision recorded there without saying so.

## Layout

```
frontend/   Next.js 15 (App Router), TypeScript, CSS Modules. Port 3200.
backend/    Bun + Hono, TypeScript, Postgres (bun:sqlite fallback). Port 3201.
shared/     Contract types and the CheckResult fixture, imported by both services.
docs/       Architecture, contracts, workstreams, design specs.
```

## Commands

```sh
# frontend
cd frontend && npm install && npm run dev        # :3200
cd frontend && npm run typecheck

# backend
cd backend && bun install && bun run dev         # :3201
cd backend && bun test
```

## Hard rules

These are not style preferences. Breaking one is a bug, and reviewers should
reject the change.

**1. No product category may appear in source code.**
Not in a constant, a prompt template, an enum, or a test fixture that production
code reads. Intent archetypes are category-agnostic; the prompts themselves are
generated from the submitted catalogue at runtime. The same code path must serve
soap, running shoes, and skincare unmodified. This is a graded criterion, not a
nicety.

**2. The scoring path contains no model calls.**
Whether an agent found the product is decided by deterministic URL matching
against the brand's domain and product pages. Models generate personas and
diagnose findings; they never decide the verdict. If you cannot explain how a
score was computed without saying "the model judged it", it is wrong.

**3. Every finding cites evidence.**
A `Finding` names the specific shopper IDs and the observed facts that produced
it. A finding that could have been written before the run happened is generic
advice, and generic advice is the thing this product exists to replace.

**4. Contract first.**
`CheckResult` and `AgentEvent` in `docs/data-contracts.md` are the interfaces
between workstreams. Changing either is a cross-team change: propose it, get
agreement, update the doc and the fixture in the same commit. Do not widen a
type locally to unblock yourself.

**5. No headless browser.**
No Playwright, Puppeteer, or Selenium. Retrieval is search plus `fetch`. See
decision D1.

**6. Never persist or log a brand's API key.**
Keys live in memory for the duration of a run. They must not reach disk in
plaintext, a log line, an `AgentEvent`, or an error message.

## Conventions

- TypeScript `strict`. Do not add `any` to move past a type error; fix the type.
- Prefer small, single-purpose files. A file doing two things should be two files.
- Match the surrounding code's comment density and naming. `frontend/src/lib/`
  documents *why* a shape exists, not what a line does — follow that.
- Errors that are data (an agent failed to find a product) are recorded and the
  run continues. Errors that invalidate the run stop it with a message. Never
  swallow an error into a silent default.
- Use the SDK's own types rather than redefining equivalents.

## Model usage

Model calls go through the **Cloudflare AI Gateway REST API**, not a provider
SDK. One entry point: `backend/src/llm.ts`.

- `POST https://api.cloudflare.com/client/v4/accounts/{id}/ai/v1/messages`,
  which speaks the Anthropic Messages schema verbatim. Plain `fetch`, no SDK.
- Auth is a Cloudflare API token with **Account > Workers AI > Read**, sent as
  `Authorization: Bearer`. There is no Anthropic key; third-party models are
  billed through Cloudflare Unified Billing, so the account needs credits.
- Model ids are provider-prefixed, e.g. `anthropic/claude-sonnet-4-5`. Override
  with `HAPPY2_MODEL`.
- Do **not** use `gateway.ai.cloudflare.com/.../anthropic` (the per-provider
  passthrough) or `/compat/chat/completions` (deprecated for single-model
  calls). Both are what search results show; neither is current.
- Structured outputs are not relied on surviving the gateway. Ask for JSON in
  the system prompt and parse defensively — `completeJson()` does this, with one
  retry that shows the model its own broken output.
- A failed model call must never kill a run. Persona generation and diagnosis
  both fall back to deterministic paths; the HTTP audit is the real payload.

## Testing

TDD for deterministic units: matching, scoring, site-audit extractors, findings
derivation. Agent runs are tested against recorded responses. CI makes no network
calls. If a test needs the internet, it is the wrong test.

## Before you claim something works

Run it. Paste the output. "Should work" is not a result — see the verification
rule in `docs/workstreams.md`.
