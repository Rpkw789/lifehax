# CLAUDE.md

**Read `AGENTS.md` first — it is the canonical working agreement for this repo.**
Everything about layout, commands, conventions, and the hard rules lives there.
This file only adds what is specific to Claude Code.

## Orientation

| Question | File |
| --- | --- |
| What are we building and why? | `SPEC.md` |
| How does the system fit together? | `docs/architecture.md` |
| What are the interfaces between us? | `docs/data-contracts.md` |
| Who owns what right now? | `docs/workstreams.md` |
| Why was it decided this way? | `docs/superpowers/specs/2026-08-29-happy2-design.md` |

## Working here

- This is a three-person project with work split across `docs/workstreams.md`.
  Stay inside your workstream's directories unless the change is to a shared
  contract — and a contract change is a conversation, not a commit.
- The four hard rules that get changes rejected: no category-specific code, no
  models in the scoring path, every finding cites evidence, no headless browser.
  `AGENTS.md` has the full list with reasoning.
- The frontend prototype under `frontend/src/lib/` was written against the
  production shapes deliberately. Its `types.ts` is close to the real contract;
  its `fixtures.ts` is placeholder data that gets replaced, not extended.

## Anthropic API

Load the `claude-api` skill before writing or editing any code that calls the
API. Defaults for this repo: `claude-opus-5`, adaptive thinking, structured
outputs, streaming for large responses.

## Verification

Do not report work as done without running it and showing the output. If tests
fail, say so and paste the failure.
