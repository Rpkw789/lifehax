# Bun runs the TypeScript directly, so there is no build step — just deps + src.
# Note: pnpm-lock.yaml in this directory is stale (it predates the Browserbase
# and zod deps). bun.lock is the source of truth; do not switch this to pnpm.
FROM oven/bun:1-slim

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY tsconfig.json ./
COPY src ./src

# Cloud Run injects PORT; src/index.ts reads it. 8080 is the platform default.
ENV PORT=8080
EXPOSE 8080

USER bun
CMD ["bun", "run", "src/index.ts"]
