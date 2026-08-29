export interface AppConfig {
  agentCount: number;
  agentConcurrency: number;
  agentAttemptTimeoutMs: number;
  runBudgetMs: number;
  cloudflareAccountId: string | null;
  cloudflareApiToken: string | null;
  cloudflareModel: "anthropic/claude-opus-4.8";
  nativeModel: "claude-opus-5";
}

type Environment = Record<string, string | undefined>;

export function readConfig(env: Environment = process.env): AppConfig {
  return {
    agentCount: positiveInteger(env.AGENT_COUNT, 20, "AGENT_COUNT"),
    agentConcurrency: positiveInteger(env.AGENT_CONCURRENCY, 4, "AGENT_CONCURRENCY"),
    agentAttemptTimeoutMs: positiveInteger(
      env.AGENT_ATTEMPT_TIMEOUT_MS,
      45_000,
      "AGENT_ATTEMPT_TIMEOUT_MS",
    ),
    runBudgetMs: positiveInteger(env.RUN_BUDGET_MS, 300_000, "RUN_BUDGET_MS"),
    cloudflareAccountId: nonEmptyOrNull(env.CLOUDFLARE_ACCOUNT_ID),
    cloudflareApiToken: nonEmptyOrNull(env.CLOUDFLARE_API_TOKEN),
    cloudflareModel: "anthropic/claude-opus-4.8",
    nativeModel: "claude-opus-5",
  };
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function nonEmptyOrNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
