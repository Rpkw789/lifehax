# Build context is the REPO ROOT, not backend/ — backend/tsconfig.json maps
# @contracts/* to ../shared/contracts/*, which is outside this package. The
# image mirrors the repo layout (/app/backend + /app/shared) so that relative
# path resolves exactly as it does locally.
#
# Bun runs the TypeScript directly, so there is no build step.
# Note: backend/pnpm-lock.yaml is stale (missing @browserbasehq/* and zod).
# bun.lock is the source of truth; do not switch this to pnpm.
FROM oven/bun:1-slim

WORKDIR /app/backend

COPY backend/package.json backend/bun.lock ./
RUN bun install --frozen-lockfile --production

COPY shared /app/shared
COPY backend/tsconfig.json ./
COPY backend/src ./src

# Render and Cloud Run both inject PORT; src/index.ts reads it.
ENV PORT=8080
EXPOSE 8080

# openFindingsStore() opens ./happy2.sqlite relative to the working directory,
# so the unprivileged user needs to own it. Note this file is ephemeral on both
# platforms — it does not survive a restart or redeploy.
RUN chown -R bun:bun /app
USER bun
CMD ["bun", "run", "src/index.ts"]
