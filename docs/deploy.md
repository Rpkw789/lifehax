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
   - `BROWSERBASE_API_KEY`
   - `CLOUDFLARE_ACCOUNT_ID`
   - `CLOUDFLARE_API_TOKEN`
   - `NEXT_PUBLIC_API_BASE` — leave blank for now, see step 4
4. Once **happy2-backend** is live, copy its URL (`https://….onrender.com`) into
   **happy2-frontend**'s `NEXT_PUBLIC_API_BASE` and redeploy the frontend.

Step 4 is manual on purpose: `src/lib/api.ts` reads `NEXT_PUBLIC_API_BASE`, which
Next inlines into the *client* bundle at build time, so it cannot be a runtime
variable. Render blueprints have no string concatenation and `onrender.com`
subdomains are globally unique, so the backend URL cannot be derived ahead of
time. Changing the backend URL later means rebuilding the frontend image, not
just editing a variable.

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
  for the duration of a run — but anything finished is gone after a sleep.
- Free services are suspended until the next month if you exhaust the 750 hours.

### The cost that isn't Render's

Render is free. Anthropic tokens through the Cloudflare AI Gateway and
Browserbase are not. Browserbase's free tier is **1 browser-hour total**, and
with `HAPPY2_REAL_AGENTS=3` a single run burns three times its wall-clock. The
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
