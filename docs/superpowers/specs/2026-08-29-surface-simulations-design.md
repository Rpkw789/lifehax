# Happy2 — Evidence-backed surface simulations

**Date:** 2026-08-29
**Status:** Approved and implemented; provider amendment approved 2026-08-29

## Problem

The Check screen presents four ways an AI shopper can reach a store, but only
the Browser column currently shows an agent doing work. Agent protocol and the
model-readable guide replay shallow audit probes, while Web search fabricates
alternating results and labels them simulated. This makes the four-column view
look complete without measuring the three non-browser methods with equivalent
honesty.

Happy2 needs one real simulation for each of these additional methods:

1. ACP/UCP agent protocol
2. `/llms.txt`
3. public Web search

All three simulations use the same target product and shopper brief. Their
console output must reveal what actually happened over time, their qualitative
criticism must be model-generated from cited evidence, and their verdicts and
scores must remain deterministic.

## Scope

This change modifies the behavior behind the three existing Check-screen areas
named **Agent protocol**, **Model-readable guide**, and **Web search**. The
Browser agents, Browserbase live tiles, journey stages, stage board, funnel,
recommendations, dashboard, and input flow stay unchanged except where the run
must carry the shared target and brief into the new workers.

The backend gains the minimal support required to fetch non-browser surfaces,
run model critiques through the existing LLM entry point, stream real progress,
and assemble the final report. No model call is made from the frontend.

## Decisions preserved

This design extends, rather than re-litigates, the decisions in
`docs/superpowers/specs/2026-08-29-happy2-design.md`:

- No headless browser is added. Protocol and guide retrieval use guarded HTTP
  fetches; Web search uses the existing hosted-search agent.
- No transaction, cart mutation, checkout, payment, or order operation is
  invoked. Protocol assessment is read-only.
- The scoring path remains deterministic. Models explain evidence but do not
  decide support, discovery, identity, rank, or score.
- No product category appears in production code. The product and brief are
  runtime values selected from the submitted store.
- Every criticism cites observed evidence.
- Existing non-surface model calls continue through Cloudflare. The three
  additional surface simulations call the OpenAI Responses API directly through
  `backend/src/llm.ts`, using strict structured outputs and hosted Web search.
- Model failures degrade one critique and never kill a run.

## Shared simulation context

After catalogue discovery and persona generation, the run coordinator freezes
one context for all three new simulations:

- **Target product:** the first readable catalogue product matching a submitted
  test SKU; otherwise the first readable catalogue product.
- **Shopper brief:** the first enabled generated brief.
- **Store origin, locale, and currency:** copied from the run.

The context is immutable for the rest of the run. This makes the three methods
directly comparable: they answer the same shopper need about the same product
through different retrieval surfaces.

If no readable product or enabled brief exists, the existing run-level failure
rules apply because the comparison would be meaningless.

## Execution architecture

The current run coordinator remains the single owner of the Check. It launches
three independent surface workers alongside the unchanged Browser population:

```text
Shared product + shopper brief
├── Protocol worker ──▶ ACP + UCP fetch, validation, critique
├── Guide worker ─────▶ llms.txt fetch, parse, linked evidence, critique
└── Search worker ────▶ blind Web search, citations, matching, verdict
```

Each worker:

1. receives the frozen context;
2. emits append-only progress events after real milestones;
3. records fetch, parse, API, extraction, and model evidence;
4. settles independently as complete, unavailable, or degraded; and
5. contributes its facts to one final `CheckResult`.

Workers have bounded timeouts and one retry for transient fetch/model failures.
A worker failure is data and does not cancel the other workers or Browser
agents. The result builder validates the complete JSON with
`assertCheckResult()` before it is streamed to the frontend.

## Protocol simulation

The protocol worker performs a read-only assessment of two surfaces:

- ACP: the submitted agent endpoint, defaulting to
  `/.well-known/agent-commerce` as the project and user-configured discovery
  location.
- UCP: `/.well-known/ucp`, the UCP business-profile discovery location.

For each response it records the requested URL, final URL, redirect behavior,
HTTP status, content type, size, fetch error, and a bounded raw excerpt. A 2xx
response does not by itself prove support. Deterministic validation inspects:

- whether the response is non-empty machine-readable content;
- JSON syntax and expected top-level shape;
- declared protocol and capability versions;
- services, transports, capabilities, and referenced endpoints/schemas;
- HTTPS and URL validity;
- UCP hosting requirements that can be observed without authentication; and
- security/authentication metadata advertised by the document.

The worker does not call any advertised operation. If usable content exists,
the model receives the shared brief, target facts, deterministic validation
facts, and bounded untrusted content. It returns an evidence-cited critique of
strengths, gaps, shopper impact, and improvements. Support remains the
deterministic validation result.

ACP is evaluated against a pinned stable ACP specification snapshot rather
than unreleased HEAD. The configured `/.well-known/agent-commerce` path is
reported as the tested discovery convention, not misrepresented as a universal
ACP requirement. UCP is evaluated against its dated profile format.

## Model-readable guide simulation

The guide worker fetches the root `/llms.txt` using the guarded store fetcher and
a bounded response size. It records the same HTTP metadata as the protocol
worker and parses the document deterministically.

The structural assessment checks:

- the required H1 site/project title;
- optional summary and explanatory content;
- H2-delimited link sections and valid Markdown links;
- concise size and parseability;
- references to the shared target product or its canonical URL;
- useful same-origin catalogue, product, policy, delivery, availability, and
  return sources discovered from runtime content; and
- broken, unsafe, duplicate, or off-origin links.

The worker may follow only a small bounded set of relevant, same-origin,
read-only links. Link selection is driven by the shared brief and parsed link
metadata; it does not hardcode a product category. Retrieved text is untrusted
data, never instructions.

When `/llms.txt` is usable, the model receives its bounded content, structural
facts, relevant linked evidence, and the shared brief. It critiques how well the
guide helps an ecommerce agent discover, understand, and assess the target.
When the document is missing, the worker reports `Unable to be found` and does
not fabricate a content critique.

The rubric follows the current `/llms.txt` proposal at <https://llmstxt.org/>:
Markdown content, one required H1, optional summary/details, and grouped link
lists that guide an agent to more detailed sources.

## Web-search simulation

The search worker uses an OpenAI Responses `web_search` agent and its structured
ranking path. It sends only the shared shopper brief, locale, and currency. The
target brand and product are not disclosed to the search model.

The worker streams:

1. the exact shopper query;
2. hosted-search API completion;
3. retrieved citations in rank order;
4. guarded fetches of same-origin cited pages;
5. structured candidate generation;
6. deterministic domain and canonical-product matching; and
7. final discovery, recommendation, and rank facts.

Candidate URLs must be backed by retrieved citations. The model-generated
candidate reason codes and explanations form the qualitative criticism, but
the existing deterministic matcher decides `target_discovered`,
`target_identity_matched`, `target_recommended`, and `target_rank`.

## Model critique contract

Protocol and guide critiques use a small structured JSON schema:

```ts
interface SurfaceCritique {
  summary: string;
  strengths: CritiquePoint[];
  gaps: CritiquePoint[];
  shopper_impact: CritiquePoint[];
  improvements: CritiquePoint[];
}

interface CritiquePoint {
  text: string;
  evidence_ids: string[];
}
```

The parser rejects unknown or empty evidence references and retries once by
showing the model its invalid output. A second invalid response produces a
deterministic fallback summary and `Critique unavailable` in the console.
Critique fields are explanatory only and are never consumed by scoring.

All retrieved content is wrapped as untrusted evidence in prompts. Prompt text
is category-agnostic and refers only to runtime product facts and the supplied
shopper brief.

## Live event and JSON data flow

The new surface progress type is separate from the existing Browser
`AgentEvent`; the Browser contract is not widened. The exact JSON is documented
in `docs/superpowers/specs/2026-08-29-surface-simulation-json-contract-update.md`.

The backend stores surface events on the in-memory run and replays them to late
or reconnecting subscribers. Stable event IDs let the frontend reducer ignore
duplicate replay. Each event is emitted only after its described work occurs;
the frontend does not create synthetic timeouts, results, citations, or
reasoning lines.

On completion the backend streams one validated `CheckResult`:

- ACP/UCP facts populate `site_audit.agent_commerce` and `site_audit.ucp`.
- `/llms.txt` facts populate `site_audit.llms_txt`.
- Web search contributes the one `agent_runs[]` entry for the shared query.
- Fetches, extractions, API calls, citations, and serialized model outputs
  populate `evidence[]`.
- Surface progress events reference the relevant `evidence_id` values.

No `CheckResult` schema change is planned. If implementation proves the
existing `Evidence` shape cannot carry the critiques without ambiguity, work
stops at the contract boundary and the contract-update document is revised for
explicit approval before types or fixtures change.

## Frontend design

The existing four-column Check layout remains. Only the bodies of Agent
protocol, Model-readable guide, and Web search change.

Each new body is a plain, dark console with predominantly white monospaced text
and muted timestamps. A compact existing-style header shows the surface name,
progress, and settled state. There are no metric cards, decorative diagrams,
fabricated typing animations, or synthetic console lines.

The console appends real events as they arrive and keeps recent activity in
view without preventing manual scrollback. It grows over time rather than
revealing a completed transcript on a client clock. Refresh and SSE reconnect
replay the same transcript without duplicates.

Expected lines include:

- context and shared target/brief selection;
- requested URLs and response metadata;
- parsing and deterministic validation milestones;
- model-call start, completion, or fallback;
- citations, same-origin fetches, URL match, and rank for Web search; and
- a final surface-specific JSON fragment.

Unavailable resources settle explicitly:

- missing or soft-404 document: `Unable to be found`;
- network/timeout failure: `Unable to verify`;
- invalid body: the observed parse/validation failure;
- model failure: measured facts followed by `Critique unavailable`.

Once all three workers settle, the page offers one expandable, contract-valid
full `CheckResult`. The Browser column and every section below the surface grid
render exactly as before.

## Error and security behavior

- No API key, token, authorization header, cookie, or complete request options
  are persisted, logged, streamed, or shown to the model.
- Raw excerpts have strict byte/character limits.
- URLs are normalized and guarded against private-network and cross-origin
  abuse using the existing fetch security path.
- Protocol and guide workers use GET-only retrieval and never mutate the store.
- One surface error does not stop the others or the Browser population.
- A model error never changes a deterministic support/search result.
- A final report that fails contract validation is not published as complete;
  the run surfaces the validation error because downstream evaluation would be
  meaningless.

## Implementation boundaries

Expected backend work:

- focused protocol, guide, and surface-orchestration modules;
- reuse of the existing Web-search client, matcher, guarded fetcher, and LLM
  entry point;
- run-state storage and SSE replay for surface events;
- final `CheckResult` storage and streaming; and
- structured model-critique parsing with deterministic fallback.

Expected frontend work:

- shared surface-event types imported from the contract location;
- API subscription handling for surface events and final `CheckResult`;
- a pure reducer from append-only events to three console transcripts;
- a small console renderer reused by the three requested columns; and
- `surfaces.ts` derivations from real event/result state instead of fabricated
  timing.

No unrelated refactor is included.

## Testing

Deterministic units are developed test-first. CI makes no network calls.

Backend tests cover:

- missing endpoints, soft 404s, redirects, invalid content, and valid ACP/UCP
  documents;
- `/llms.txt` structure, target coverage, relevant links, unsafe links,
  truncation, and missing files;
- evidence-cited critique validation, one retry, and fallback;
- recorded Web-search responses, blind queries, citations, deterministic URL
  matching, rank, provider error, and timeout;
- identical shared context passed to all three workers;
- actual event order, stable IDs, replay, and independent worker failure; and
- final `assertCheckResult()` validation and resolvable evidence references.

Frontend tests cover:

- incremental event folding and ordering;
- duplicate replay suppression;
- strict isolation between the three surface consoles;
- unavailable, degraded, and completed display states;
- relevant per-surface JSON extraction; and
- full report visibility only after the final result arrives.

Completion verification runs:

```sh
cd backend && bun test && bun run typecheck
cd frontend && bun test && npm run typecheck && npm run build
```

A local rendered smoke check is performed when the runtime has the required
credentials. Recorded responses remain the authoritative automated test path.

## Success criteria

1. The three new panels use the same target product and shopper brief.
2. Each panel visibly accumulates real console activity over time.
3. ACP/UCP and `/llms.txt` contents are fetched and critiqued when present.
4. Missing resources are shown as unavailable without fabricated content.
5. Web search is brand-blind and cites real retrieved URLs.
6. Support, discovery, identity, and rank are deterministic.
7. Every critique point names real evidence IDs.
8. The final JSON passes the existing `CheckResult` validator.
9. Existing Browser behavior and unrelated frontend sections do not change.

## Primary standards references

- ACP specification repository: <https://github.com/agentic-commerce-protocol/agentic-commerce-protocol>
- OpenAI ACP overview: <https://openai.com/index/buy-it-in-chatgpt/>
- UCP specification and business profile discovery:
  <https://ucp.dev/2026-04-08/specification/overview/>
- `/llms.txt` proposal: <https://llmstxt.org/>
