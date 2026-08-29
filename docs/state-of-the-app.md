# State of the app

Measured on `main` at `c7f7cec`, not from memory. Reachability is an import
walk from `backend/src/index.ts`; everything else is a grep or a live request.

Rerun the walk with the snippet at the bottom before trusting these numbers —
they move every time someone pushes.

## What genuinely works

Verified against a real run on `allbirds.com`:

- **Catalogue crawl** — 12 products from `products.json`, 293 from the sitemap.
- **Site audit probes** — `agentCommerce=404 ucp=200 llmsTxt=200 sitemap=200`.
- **Structured-data checks** — `withJsonLd=4 withOfferPrice=4 priceInServedHtml=4 withCartForm=0`.
- **Surface scores** — `computeSurfaces()` is arithmetic over those probes. No
  model decides a number.
- **Three real browser agents** via Browserbase and Stagehand.
- **SSE streaming** — Input, Check and Recommend all read the live run.
- **The Evaluate engine** — deterministic rules, contract-validated, 114 tests.

## What does not work, in the order worth fixing

### 1. The LLM is not connected

`CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` are one character each in
the working `.env`, so the gateway returns `401` and `findings.ts` falls back to
`ruleFindings`. Every finding and persona shown so far is canned. The last real
run produced **one** finding.

`/health` reports `llm: true` because it only checks the variables are
non-empty, not that they work.

**Fix:** a real account id and an **AI Gateway token** with the `AI Gateway Run`
permission, created inside the gateway's Settings. A general Cloudflare API
token produces exactly this 401. Confirm `CLOUDFLARE_GATEWAY_ID` is the
gateway's real name.

This is one config change and it is the largest gap between what the product
claims and what it does.

### 2. Half the backend never executes

**25 of 50 modules, 2,416 lines, unreachable from `index.ts`.**

| Area | Dark modules |
| --- | --- |
| `agents/` | 8 |
| `catalogue/` | 5 |
| `runs/` | 4 |
| `personas/`, `models/` | 2 each |
| `audit/`, `score/` | 1 each |
| root (`env.ts`, `fixtures.ts`) | 2 |

Nothing calls `runSimulation`. The server still imports the older flat files —
`agents.ts`, `catalogue.ts`, `checks.ts`, `personas.ts`, `findings.ts`.

So there are two of almost everything: two catalogue readers, two persona
generators, two agent systems, two scoring paths. The dark half is the better
one — tested, contract-shaped, 20 passing tests — and it is invisible to users.

**This needs a decision, not a fix.** Either wire `runSimulation` in and delete
the flat files, or shelve the new stack and stop growing it. Carrying both is
how a hackathon codebase doubles in a day.

### 3. Seven of ten agents are scripted

`agents.ts` says so itself:

> Their failure reasons are pulled from the real audit so the console never
> states something untrue about the store, but their pass/fail pattern is not a
> measurement. Do not report them as one.

The last real run makes the gap concrete. Stages cleared per agent:

```
A01: 1   A02: 4   A03: 4   A04: 1   A05: 4
A06: 4   A07: 1   A08: 4   A09: 4   A10: 6
```

`A01`, `A04` and `A07` are the three real Browserbase agents. They cleared
**one** stage each. The seven that reached stage 4 are scripted. The dashboard
funnel presents both as measured.

Three is not arbitrary — the Browserbase free tier allows 3 concurrent
browsers and 5 session requests per minute. Raising `HAPPY2_REAL_AGENTS`
without pooling more keys trips a `429`.

**Options:** pool more keys, or mark scripted agents in the UI. Saying "10
agents shopped your store" is not currently true.

### 4. Prototype fixtures still drive the Check screen

`LivestreamTile.tsx` reads four hardcoded constants from `lib/fixtures.ts`:

- `TILE_CLIPS` — canned mp4s of Sephora, Shein, Shopee, Footlocker and others.
  Tiles without a live Browserbase session play stock footage of stores nobody
  audited.
- `RING_REGIONS`, `STAGE_PATHS`, `STAGE_ACTIONS` — focus rings, URL bars and
  action captions, all prototype copy.

`STAGE_PASS_LOGS` feeds the console the same way. `TILE_IDS` is now unused and
can go.

Category strings live here too — `desk+lamp+dimmable`, `atlas-lamp` — which
breaks the no-product-category rule in `AGENTS.md` once these reach real data.

### 5. The Evaluate endpoint is unreachable by clicking

`POST /runs/:id/evaluate` works and is tested, but no screen calls it. Recommend
uses findings from the SSE stream instead. The lane is reachable by `curl` only.

That is a consequence of item 2 — Evaluate consumes a `CheckResult`, which only
the dark pipeline produces.

## Live endpoints

```
GET  /health
POST /runs
GET  /runs/:id
GET  /runs/:id/events      SSE
POST /runs/:id/evaluate    works, unused by the UI
```

No re-run, no run history, no artifact hosting. The self-verifying loop in
`SPEC.md` has no backing endpoint: nothing persists a run or links one to a
previous one.

## Decisions this needs

1. **Who fixes the Cloudflare credentials, and when.** Everything else is
   cosmetic next to it.
2. **Does `runSimulation` replace `runPopulation` before the demo?** If yes,
   wire it and delete the flat files. If no, stop adding to `agents/`,
   `catalogue/`, `runs/`.
3. **How do we describe the agent population?** Three real, or pool keys for
   more, or label the scripted ones.
4. **Do the tile clips stay?** They demo well and they are footage of other
   people's stores.

## Rerunning the reachability walk

```sh
cd backend && python3 - <<'PY'
import os, re, pathlib
root = pathlib.Path("src")
files = {str(p) for p in root.rglob("*.ts") if ".test." not in p.name}
def imports(p):
    out = set()
    for m in re.finditer(r'from\s+"(\./[^"]+|\.\./[^"]+)"', pathlib.Path(p).read_text()):
        b = os.path.normpath(os.path.join(os.path.dirname(p), m.group(1).replace(".ts", "")))
        for c in (b + ".ts", os.path.join(b, "index.ts")):
            if c in files:
                out.add(c)
                break
    return out
seen, stack = set(), ["src/index.ts"]
while stack:
    f = stack.pop()
    if f in seen or f not in files:
        continue
    seen.add(f)
    stack.extend(imports(f))
dark = sorted(files - seen)
print(f"live={len(seen)} dark={len(dark)}")
for f in dark:
    print(" ", f)
PY
```
