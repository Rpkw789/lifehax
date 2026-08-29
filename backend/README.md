# Happy2 backend

Bun + Hono on **:3201**. Audits a storefront for AI-shopper readiness and
streams a population of shopping agents over SSE.

## Run

```sh
bun install
cp .env.example .env     # then fill it in — see Keys below
bun run dev              # http://localhost:3201
```

The frontend expects this on 3201; it runs on 3200.

## Keys

Everything works without keys — the audit is plain `fetch`, personas fall back
to category-agnostic archetypes, and findings fall back to deterministic rules.
Keys upgrade two things:

| Variable | Unlocks | Without it |
| --- | --- | --- |
| `BROWSERBASE_API_KEY` | the 3 real browser agents | those 3 report "BROWSERBASE_API_KEY is not set" |
| `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` | generated briefs, written findings | archetype briefs, rule-based findings |

Cloudflare token needs **Account > Workers AI > Read**. Account id from
`npx wrangler whoami`. Browserbase free tier is 3 concurrent browsers and one
browser-hour total, which is why `HAPPY2_REAL_AGENTS` defaults to 3.

Verify the gateway independently before blaming the app:

```sh
curl -X POST "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/ai/v1/messages" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"model":"anthropic/claude-sonnet-4-5","max_tokens":64,
       "messages":[{"role":"user","content":"say hi"}]}'
```

## API

| Method | Path | |
| --- | --- | --- |
| `POST` | `/runs` | `RunInput` → `{ runId }`; starts work async |
| `GET` | `/runs/:id` | full snapshot: catalogue, personas, checks, surfaces, findings, events |
| `GET` | `/runs/:id/events` | SSE: `catalogue`, `personas`, `checks`, `agent`, `findings`, `done` |
| `GET` | `/health` | liveness, plus which keys are configured |

Errors are `{ error: { code, message } }` with the status carrying the class.

```sh
curl -s -X POST localhost:3201/runs -H 'content-type: application/json' \
  -d '{"storeUrl":"https://www.hiutdenim.co.uk"}'
curl -sN localhost:3201/runs/<id>/events
```

## Shape

```
index.ts       routes, CORS, SSE, orchestration
catalogue.ts   sitemap / products.json -> product list
personas.ts    catalogue -> ~5 briefs (one model call)
checks.ts      the HTTP audit — where findings come from
agents.ts      3 real Stagehand runs + 7 scripted
findings.ts    surfaces (arithmetic) + findings (model, with rule fallback)
llm.ts         the only model entry point
store.ts       in-memory runs + per-run event bus
http.ts        fetch helpers, JSON-LD extraction
```

Run state is in memory and vanishes on restart.

## Two things to know

**`agents.ts` has three real agents and seven scripted ones.** The scripted ones
exist so the Check screen reads as a population. Their pass/fail *pattern* is
not a measurement — but every reason string they print is taken from the real
audit, so they never assert something untrue about the store. Do not report
their outcomes as measured results.

**The diagnosis lives in `checks.ts`, not in the agents.** The browser agents
are the visual; the `fetch` probes are the evidence. That is what keeps a run
fast, free, and honest when Browserbase is unavailable.
