# Deploying

Two paths. **Render is the default** — no credit card, no billing account, no
way to be charged. Cloud Run is documented at the bottom for when this needs to
outgrow a demo.

---

## Render (recommended)

Both services deploy from `render.yaml` at the repo root.

1. Push the branch to GitHub.
2. Render dashboard → **New → Blueprint** → pick this repo.
3. Render reads `render.yaml`, finds both services, and prompts for the values
   marked `sync: false`:
   - `BROWSERBASE_API_KEYS` — comma-separated, no spaces. Browserbase allows 3
     concurrent browsers per account, so one key per teammate means
     proportionally more agents really browse; the backend sizes the population
     from the number of keys.
   - `CLOUDFLARE_ACCOUNT_ID`
   - `CLOUDFLARE_API_TOKEN` — a Cloudflare API token with **Account > Workers
     AI > Read**. Third-party model usage is billed through Unified Billing.
   - `OPENAI_API_KEY` — direct Responses API access for the ACP/UCP,
     `llms.txt`, and Web-search surface simulations, and optionally the real
     browser agents when `HAPPY2_AGENT_MODEL` selects an OpenAI model.
   - `NEXT_PUBLIC_API_BASE` — leave blank for now, see step 5
4. Create the database **by hand**: **New → Postgres**, free plan, the same
   region as the services. The `databases:` block in `render.yaml` does *not*
   do this for you — see below. Then copy its **Internal Database URL** into
   **happy2-backend** → Environment → `DATABASE_URL`. Saving redeploys the
   service on its own.
5. Once **happy2-backend** is live, copy its URL (`https://….onrender.com`) into
   **happy2-frontend**'s `NEXT_PUBLIC_API_BASE` and redeploy the frontend.

Step 5 is manual on purpose: `src/lib/api.ts` reads `NEXT_PUBLIC_API_BASE`, which
Next inlines into the *client* bundle at build time, so it cannot be a runtime
variable. Render blueprints have no string concatenation and `onrender.com`
subdomains are globally unique, so the backend URL cannot be derived ahead of
time. Changing the backend URL later means rebuilding the frontend image, not
just editing a variable.

### The blueprint does not provision the database

`render.yaml` declares `databases: - name: lifehax`, but nothing acts on it.
Render's GitHub App is not installed on this repo — `deploy.yml` says as much —
so no blueprint sync happens, and `deploy.yml` itself drives the REST API by
service id, which only redeploys existing services. The block is there so the
names line up if anyone ever does sync it, and so `fromDatabase` resolves.

In practice that means the database and its `DATABASE_URL` are dashboard state,
not repo state. Confirm which one the backend actually picked up:

```sh
curl -s https://happy2-backend.onrender.com/health
# {"ok":true,...,"db":"postgres"}   <- reading the database
# {"ok":true,...,"db":"sqlite"}     <- fell back; DATABASE_URL is not set
```

`sqlite` there is not an error — the backend works, it just writes to a
container-local file that the next deploy or spin-down erases.

### Why Render suits this app

Render does not throttle CPU between requests. `index.ts` fires
`orchestrate(run)` *after* the `POST /runs` response returns, and that pattern
just works here — on Cloud Run it needs a specific flag to avoid stalling (see
below).

### Free tier limits that will bite

- **750 instance-hours/month per workspace**, shared across both services.
- Services **sleep after 15 minutes idle**, with a **30–60s cold start** on the
  next request. Sleeping services don't consume hours. Load the page a minute
  before demoing.
- Sleeping wipes the backend's in-memory run store (`store.ts` says as much).
  A run in progress holds its SSE connection open, so the service stays awake
  for the duration of a run. A *finished* run survives, because it is written to
  Postgres — but only what was written: the live run's SSE stream is gone, and
  reopening the run replays it from the saved document.
- **A free Postgres is deleted 30 days after it is created.** Render emails
  first and gives a 14-day grace period to upgrade, which keeps the data.
  Ignoring it loses every saved run. This is the single deadline on this
  deployment; nothing else here expires.
- Free web services **cannot** attach a persistent disk, which is why saved runs
  go to Postgres rather than the `bun:sqlite` file the code falls back to
  locally. That file exists in the container and is wiped by every deploy.
- Free services are suspended until the next month if you exhaust the 750 hours.

### The cost that isn't Render's

Render is free. Anthropic tokens through the Cloudflare AI Gateway, OpenAI
Responses and Web-search usage, and Browserbase are not. Browserbase's free
tier is **1 browser-hour per account**,
and a run burns one browser-hour multiple of its wall-clock per real agent —
nine agents across three pooled keys spend roughly three hours' worth of
allowance per hour of demoing, drawn from whichever accounts the keys belong to.
The
backend URL is public, so anyone who finds it can spend your quota — delete the
services when you're done demoing.

---

## Cloud Run (requires billing)

`./deploy.sh` handles both services. Needs an active GCP billing account —
Cloud Run requires one even to use the free tier. Note that **GCP budget alerts
do not cap spend**; they only send email. The only hard stop is a
budget → Pub/Sub → Cloud Function that detaches the billing account.

```sh
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
./deploy.sh                # or: ./deploy.sh backend | ./deploy.sh frontend
```

Always Free allowance: 2M requests, 180,000 vCPU-s, 360,000 GiB-s per month.

### The two flags you cannot drop

**`--max-instances=1`** — `store.ts` keeps runs in an in-memory `Map`, so a
second instance would 404 the SSE stream for a run it never saw.

**`--no-cpu-throttling`** — under Cloud Run's default request-based billing, CPU
is throttled to near-zero the moment a request finishes, so the fire-and-forget
`orchestrate(run)` stalls in the gap before the client opens
`/runs/:id/events`. This flag switches to instance-based billing, where the free
allowance is about **50 instance-hours/month** — fine with `--min-instances=0`,
but `--min-instances=1` burns the month in roughly two days.

`--timeout=3600` covers the long-lived SSE stream; Bun's `idleTimeout: 255` and
the 15s server pings keep it alive underneath.

`deploy.sh` uses `--allow-unauthenticated`. For a locked-down demo, swap it for
`--no-allow-unauthenticated` and reach the service through
`gcloud run services proxy`.

### Images

Uncompressed: backend ~215 MB, frontend ~308 MB. Artifact Registry's free tier
is 0.5 GB of compressed layers, so one `:latest` tag each fits — but untagged
layers accumulate across deploys:

```sh
gcloud artifacts repositories set-cleanup-policies happy2 \
  --location=us-central1 --policy=- <<'POLICY'
[{"name":"keep-recent","action":{"type":"Keep"},"mostRecentVersions":{"keepCount":2}}]
POLICY
```

---

## Note on lockfiles

`backend/pnpm-lock.yaml` is stale — it lists only `hono` and `@types/bun`, and
is missing `@browserbasehq/*` and `zod`. `bun.lock` is the source of truth and
is what `backend/Dockerfile` installs from. `frontend/package-lock.json` is in
sync and is what the frontend image uses.
