# Happy2

Brands write product content for people browsing and for search engines. More
and more buying starts with a question to an AI assistant instead — *"lightweight
trail shoes under S$200 for humid weather"* — and an assistant can only
recommend what it can retrieve, parse and reason about.

Happy2 measures whether a store is reachable that way, diagnoses why it is not,
and hands back the fix.

## Run it

Two services. Backend on **:3201**, frontend on **:3200**.

```sh
# backend
cd backend
bun install
cp .env.example .env      # optional — see Keys
bun run dev

# frontend, in a second terminal
cd frontend
npm install
npm run dev
```

Then open <http://localhost:3200>.

**It works with no keys at all.** The audit is plain `fetch`, personas fall back
to category-agnostic archetypes, and findings fall back to deterministic rules.
Keys upgrade the run rather than enable it.

## The four screens

| Screen | What it does |
| --- | --- |
| **Input** | Submit a store URL. The catalogue is read from `products.json` or the sitemap. |
| **Check** | A population of shopping agents works through the store, streamed live over SSE. |
| **Recommend** | Ranked findings, each citing what was observed. |
| **Dashboard** | Where agents dropped out, and the four surface scores. |

## Keys

| Variable | Unlocks | Without it |
| --- | --- | --- |
| `BROWSERBASE_API_KEYS` | the real browser agents | those agents report the key is missing |
| `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` | generated briefs and written findings | archetype briefs, rule-based findings |
| `OPENAI_API_KEY` | ACP/UCP and `llms.txt` critiques plus the additional Web-search simulation | HTTP surface evidence still runs; critiques fall back and Web search reports unavailable |

The Cloudflare token must be an **AI Gateway token** with the `AI Gateway Run`
permission, created inside the gateway's own Settings. A general Cloudflare API
token fails with a bare `401` that says nothing about permissions — budget an
hour if you get this wrong. `CLOUDFLARE_GATEWAY_ID` must be the gateway's real
name; `default` only works if a gateway is literally called that. The Anthropic
key itself lives in the gateway via BYOK, so no provider key appears in this
repo.

Browserbase's free tier allows 3 concurrent browsers and 5 session requests per
minute per account, which is why `HAPPY2_REAL_AGENTS` defaults to 3. Pool more
keys in `BROWSERBASE_API_KEYS` (comma-separated) to run more.

Check what a running server picked up:

```sh
curl -s localhost:3201/health
# {"ok":true,"llm":true,"surfaceOpenAi":true,"browserbase":true}
```

That reports whether the variables are *set*, not whether they *work*. If
findings look generic, look for a `gateway rejected the request` line in the
backend log.

## Layout

```
backend/    Bun + Hono. The audit, the agents, the findings engine.
frontend/   Next.js. The four screens.
shared/     Contracts and fixtures both sides import.
docs/       Architecture, contracts, workstreams, specs.
```

The audit lives in `backend/src/checks.ts` — plain HTTP probes for JSON-LD,
`llms.txt`, `/.well-known/agent-commerce`, sitemap coverage and whether prices
survive without JavaScript. **That is where the evidence comes from.** The
browser agents are the visual; the probes are the measurement. It is what keeps
a run fast, free and honest when Browserbase is unavailable.

## Verify

```sh
cd backend  && bun test && bun run typecheck
cd frontend && bun test && npm run typecheck
```

No network access is required by either suite.

## Where to read next

| Question | File |
| --- | --- |
| What are we building and why? | [`SPEC.md`](SPEC.md) |
| **What actually works right now?** | [`docs/state-of-the-app.md`](docs/state-of-the-app.md) |
| How is it put together? | [`docs/architecture.md`](docs/architecture.md) |
| What are the shared types? | [`docs/data-contracts.md`](docs/data-contracts.md) |
| Conventions and hard rules | [`AGENTS.md`](AGENTS.md) |
| Backend detail | [`backend/README.md`](backend/README.md) |

Start with `docs/state-of-the-app.md`. It is measured rather than remembered,
and it is honest about which parts of the product are real, which are scripted,
and which decisions the team still owes itself.

## One thing to know before demoing

Not every agent in a run is real. `backend/src/agents.ts` runs three genuine
browser agents and scripts the rest so the Check screen reads as a population.
Every reason string a scripted agent prints comes from the real audit, so none
of them asserts something untrue about the store — but their pass/fail pattern
is not a measurement, and should not be reported as one.
