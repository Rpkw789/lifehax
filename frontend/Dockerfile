# Build context is the REPO ROOT, not frontend/ — frontend/tsconfig.json maps
# @contracts/* and @fixtures/* to ../shared/*, which is outside this package
# (next.config.ts sets experimental.externalDir for the same reason). The image
# mirrors the repo layout (/app/frontend + /app/shared) so those paths resolve
# exactly as they do locally.
#
# NEXT_PUBLIC_API_BASE is read by src/lib/api.ts in client code, so Next inlines
# it at build time — it must be a build arg, not a runtime env var. Render
# exposes service env vars as build args automatically.
FROM node:22-slim AS deps
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

FROM node:22-slim AS builder
WORKDIR /app/frontend
COPY --from=deps /app/frontend/node_modules ./node_modules
COPY shared /app/shared
COPY frontend ./
ARG NEXT_PUBLIC_API_BASE
ENV NEXT_PUBLIC_API_BASE=$NEXT_PUBLIC_API_BASE
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=8080
ENV HOSTNAME=0.0.0.0

# Verified: the standalone bundle is flat (server.js at its root) — everything
# shared/ contributes is types and one JSON fixture, all inlined at build time,
# so externalDir does not push Next's file-tracing root above frontend/.
COPY --from=builder /app/frontend/.next/standalone ./
COPY --from=builder /app/frontend/.next/static ./.next/static
COPY --from=builder /app/frontend/public ./public

EXPOSE 8080
USER node
CMD ["node", "server.js"]
