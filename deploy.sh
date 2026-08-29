#!/usr/bin/env bash
#
# Deploys happy2 to Cloud Run, inside the Always Free tier.
#
# Backend first (the frontend bakes the backend URL in at build time), then the
# frontend. Re-running is safe and idempotent.
#
#   ./deploy.sh              # deploy both
#   ./deploy.sh backend      # backend only
#   ./deploy.sh frontend     # frontend only (reuses the deployed backend URL)
#
set -euo pipefail

REGION="${REGION:-us-central1}"
REPO="${REPO:-happy2}"
BACKEND_SERVICE="${BACKEND_SERVICE:-happy2-backend}"
FRONTEND_SERVICE="${FRONTEND_SERVICE:-happy2-frontend}"

cd "$(dirname "$0")"

PROJECT="${PROJECT:-$(gcloud config get-value project 2>/dev/null)}"
if [[ -z "$PROJECT" || "$PROJECT" == "(unset)" ]]; then
  echo "No project set. Run: gcloud config set project YOUR_PROJECT_ID" >&2
  exit 1
fi
REGISTRY="${REGION}-docker.pkg.dev/${PROJECT}/${REPO}"

# Secrets come from backend/.env if you have one locally; otherwise export them
# yourself before running this.
if [[ -f backend/.env ]]; then
  set -a; . ./backend/.env; set +a
fi

step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

bootstrap() {
  step "Enabling APIs (no-op after the first run)"
  gcloud services enable \
    run.googleapis.com \
    cloudbuild.googleapis.com \
    artifactregistry.googleapis.com \
    secretmanager.googleapis.com \
    --project "$PROJECT"

  step "Ensuring Artifact Registry repo '${REPO}' exists"
  gcloud artifacts repositories describe "$REPO" \
    --location "$REGION" --project "$PROJECT" >/dev/null 2>&1 || \
  gcloud artifacts repositories create "$REPO" \
    --repository-format=docker --location "$REGION" --project "$PROJECT" \
    --description="happy2 images"
}

# put_secret NAME VALUE — creates or adds a version, then grants the runtime SA read access.
put_secret() {
  local name="$1" value="$2"
  if [[ -z "$value" ]]; then
    echo "  ! ${name} is empty — skipping (the service will run degraded)" >&2
    return
  fi
  if gcloud secrets describe "$name" --project "$PROJECT" >/dev/null 2>&1; then
    # Only add a version if the value actually changed, to stay under the free
    # 6-active-versions-per-secret limit.
    local current
    current="$(gcloud secrets versions access latest --secret "$name" --project "$PROJECT" 2>/dev/null || true)"
    if [[ "$current" == "$value" ]]; then
      echo "  = ${name} unchanged"
      return
    fi
    printf '%s' "$value" | gcloud secrets versions add "$name" --data-file=- --project "$PROJECT" >/dev/null
    echo "  + ${name} new version"
  else
    printf '%s' "$value" | gcloud secrets create "$name" --data-file=- \
      --replication-policy=automatic --project "$PROJECT" >/dev/null
    echo "  + ${name} created"
  fi
}

sync_secrets() {
  step "Syncing secrets to Secret Manager"
  put_secret BROWSERBASE_API_KEY "${BROWSERBASE_API_KEY:-}"
  put_secret CLOUDFLARE_API_TOKEN "${CLOUDFLARE_API_TOKEN:-}"
  put_secret OPENAI_API_KEY "${OPENAI_API_KEY:-}"

  local pnum sa
  pnum="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
  sa="${pnum}-compute@developer.gserviceaccount.com"
  for name in BROWSERBASE_API_KEY CLOUDFLARE_API_TOKEN OPENAI_API_KEY; do
    gcloud secrets add-iam-policy-binding "$name" \
      --member "serviceAccount:${sa}" \
      --role roles/secretmanager.secretAccessor \
      --project "$PROJECT" >/dev/null 2>&1 || true
  done
}

deploy_backend() {
  step "Building backend image"
  gcloud builds submit backend \
    --tag "${REGISTRY}/backend:latest" \
    --project "$PROJECT"

  step "Deploying ${BACKEND_SERVICE}"
  # --max-instances=1 is REQUIRED: store.ts keeps runs in an in-memory Map, so a
  #   second instance would 404 the SSE stream for a run it never saw.
  # --no-cpu-throttling is REQUIRED: index.ts fires orchestrate() after the POST
  #   response returns; with default request-based billing the CPU is throttled
  #   in the gap before the client opens /events and the run stalls.
  # --min-instances=0 keeps it scaling to zero, which is what keeps this free.
  # --timeout=3600 covers the long-lived SSE stream.
  gcloud run deploy "$BACKEND_SERVICE" \
    --image "${REGISTRY}/backend:latest" \
    --region "$REGION" --project "$PROJECT" \
    --allow-unauthenticated \
    --cpu=1 --memory=512Mi \
    --min-instances=0 --max-instances=1 \
    --no-cpu-throttling \
    --timeout=3600 \
    --set-env-vars "CLOUDFLARE_ACCOUNT_ID=${CLOUDFLARE_ACCOUNT_ID:-},CLOUDFLARE_GATEWAY_ID=${CLOUDFLARE_GATEWAY_ID:-default},HAPPY2_MODEL=${HAPPY2_MODEL:-claude-sonnet-5},HAPPY2_OPENAI_MODEL=${HAPPY2_OPENAI_MODEL:-gpt-5-mini},HAPPY2_REAL_AGENTS=${HAPPY2_REAL_AGENTS:-3},HAPPY2_STAGE_DELAY_MS=${HAPPY2_STAGE_DELAY_MS:-0}" \
    --set-secrets "BROWSERBASE_API_KEY=BROWSERBASE_API_KEY:latest,CLOUDFLARE_API_TOKEN=CLOUDFLARE_API_TOKEN:latest,OPENAI_API_KEY=OPENAI_API_KEY:latest"
}

backend_url() {
  gcloud run services describe "$BACKEND_SERVICE" \
    --region "$REGION" --project "$PROJECT" --format='value(status.url)'
}

deploy_frontend() {
  local api_base
  api_base="$(backend_url)"
  if [[ -z "$api_base" ]]; then
    echo "Backend not deployed yet — run './deploy.sh backend' first." >&2
    exit 1
  fi

  step "Building frontend image (NEXT_PUBLIC_API_BASE=${api_base})"
  gcloud builds submit frontend \
    --config frontend/cloudbuild.yaml \
    --substitutions "_API_BASE=${api_base},_IMAGE=${REGISTRY}/frontend:latest" \
    --project "$PROJECT"

  step "Deploying ${FRONTEND_SERVICE}"
  gcloud run deploy "$FRONTEND_SERVICE" \
    --image "${REGISTRY}/frontend:latest" \
    --region "$REGION" --project "$PROJECT" \
    --allow-unauthenticated \
    --cpu=1 --memory=512Mi \
    --min-instances=0 --max-instances=2 \
    --timeout=300
}

TARGET="${1:-all}"
case "$TARGET" in
  backend)  bootstrap; sync_secrets; deploy_backend ;;
  frontend) bootstrap; deploy_frontend ;;
  all)      bootstrap; sync_secrets; deploy_backend; deploy_frontend ;;
  *) echo "usage: $0 [all|backend|frontend]" >&2; exit 1 ;;
esac

step "Done"
echo "  backend:  $(backend_url)"
if [[ "$TARGET" != "backend" ]]; then
  echo "  frontend: $(gcloud run services describe "$FRONTEND_SERVICE" \
    --region "$REGION" --project "$PROJECT" --format='value(status.url)')"
fi
