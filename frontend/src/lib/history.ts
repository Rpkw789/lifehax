/**
 * Successive runs against one store, oldest first.
 *
 * `RunSummary` carries no readiness score, so an iteration is compared on what
 * it does carry: findings raised and agents blocked. Fewer of either is an
 * improvement, and both are counts a brand can act on.
 */

/** Mirrors `backend/src/persistence/runs.ts`. */
export interface RunSummary {
  runId: string;
  storeUrl: string;
  status: string;
  createdAt: string;
  findings: number;
  blocked: number;
}

export interface Iteration extends RunSummary {
  /** Change against the previous run for this store. Null for the first. */
  findingsDelta: number | null;
  blockedDelta: number | null;
}

/**
 * Host of a store URL, without scheme, `www.` or path, so
 * `http://www.acme.com/products/x` and `https://acme.com` are one storefront.
 * Returns the input lowercased if it cannot be parsed, which keeps a malformed
 * value from matching everything.
 */
function hostOf(storeUrl: string): string {
  const trimmed = storeUrl.trim().toLowerCase();
  const withScheme = /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withScheme).hostname.replace(/^www\./, "");
  } catch {
    return trimmed;
  }
}

/** Finished runs against `storeUrl`, oldest first, each carrying its deltas. */
export function iterationsFor(runs: RunSummary[], storeUrl: string): Iteration[] {
  const host = hostOf(storeUrl);

  const mine = runs
    // A run that errored measured nothing; showing it as an iteration would
    // read as a regression that never happened.
    .filter((r) => r.status === "complete" && hostOf(r.storeUrl) === host)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return mine.map((run, i) => {
    const previous = i === 0 ? null : mine[i - 1]!;
    return {
      ...run,
      findingsDelta: previous ? run.findings - previous.findings : null,
      blockedDelta: previous ? run.blocked - previous.blocked : null,
    };
  });
}
