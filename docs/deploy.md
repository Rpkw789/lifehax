# Deploying to Cloud Run

`./deploy.sh` puts both services on Cloud Run inside the Always Free tier
(2M requests, 180,000 vCPU-s, 360,000 GiB-s per month, no expiry).

```sh
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
./deploy.sh                # or: ./deploy.sh backend | ./deploy.sh frontend
```

Secrets are read from `backend/.env` if it exists, otherwise from your
environment. `BROWSERBASE_API_KEY` and `CLOUDFLARE_API_TOKEN` go into Secret
Manager (6 active versions and 10k accesses/month are free); the rest are plain
env vars on the service.

## The two flags you cannot drop

**`--max-instances=1`** — `store.ts` keeps runs in an in-memory `Map`. A second
instance would 404 the SSE stream for a run it never saw. This also means the
deploy is single-instance by construction; it is a demo topology, not a
production one. The documented fix is the `bun:sqlite` store the architecture
calls for.

**`--no-cpu-throttling`** — `index.ts` fires `orchestrate(run)` *after* the
`POST /runs` response returns. Under Cloud Run's default request-based billing
the CPU is throttled to near-zero the moment a request finishes, so the run
would stall in the gap before the client opens `/runs/:id/events`. This flag
switches to instance-based billing, where the free allowance works out to about
**50 instance-hours/month** — fine with `--min-instances=0` (scale to zero),
but setting `--min-instances=1` burns the whole month in roughly two days.

`--timeout=3600` covers the long-lived SSE stream; Bun's `idleTimeout: 255` and
the 15s server pings keep the connection alive under it.

## Cost

At 1 vCPU, CPU is the binding constraint: a ~3-minute run holds SSE open for its
whole duration, so ~180 vCPU-s per run, giving roughly **1,000 runs/month free**.

The GCP side is the cheap part. The real spend is Anthropic tokens through the
Cloudflare AI Gateway and Browserbase, whose free tier is **1 browser-hour
total** — with `HAPPY2_REAL_AGENTS=3`, one run consumes three times its
wall-clock. That runs out long before Cloud Run's free tier does.

## Images

Uncompressed: backend ~215 MB, frontend ~308 MB. Artifact Registry's free tier
is 0.5 GB and stores compressed layers, so a single `:latest` tag each fits —
but untagged layers from previous deploys accumulate. Add a cleanup policy if it
gets close:

```sh
gcloud artifacts repositories set-cleanup-policies happy2 \
  --location=us-central1 --policy=- <<'POLICY'
[{"name":"keep-recent","action":{"type":"Keep"},"mostRecentVersions":{"keepCount":2}}]
POLICY
```

## Frontend build arg

`src/lib/api.ts` reads `NEXT_PUBLIC_API_BASE`, which Next inlines into the
client bundle at build time — it cannot be a runtime env var on the service.
That is why the backend deploys first and `frontend/cloudbuild.yaml` exists: it
passes the backend URL as a `--build-arg`, which `gcloud run deploy --source`
cannot do.
