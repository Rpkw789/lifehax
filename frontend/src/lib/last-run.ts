/**
 * The last run the browser was looking at.
 *
 * The sidebar's run-scoped rows build their hrefs from a run id, and the
 * settings screen sits outside any run — so without this it renders those rows
 * inert and the rail has no way out. Remembering the id the user last had in
 * scope gives them somewhere to go back to.
 *
 * Deliberately free of React and of `window`, matching `theme-preference`:
 * storage is passed in, so the "no storage at all" case is a type rather than
 * a special case.
 */

export const LAST_RUN_KEY = "happy2.run.last";

/** The subset of `Storage` we touch. Narrow on purpose — it keeps tests honest. */
export interface RunIdStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * A stored id is interpolated straight into `/runs/${id}/input`, and storage is
 * user-writable, so a value carrying a slash or a scheme would navigate
 * somewhere other than a run. Only the shape real run ids take is allowed.
 */
export function isRunId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

/** Anything unexpected — missing, malformed, or a throwing storage — means "no run". */
export function readLastRunId(storage: RunIdStorage | null): string | null {
  if (!storage) return null;
  try {
    const stored = storage.getItem(LAST_RUN_KEY);
    return isRunId(stored) ? stored : null;
  } catch {
    return null;
  }
}

/**
 * A failed write costs the user a shortcut on their next visit. It must not
 * cost them the navigation they are doing right now.
 */
export function writeLastRunId(storage: RunIdStorage | null, runId: string): void {
  if (!storage || !isRunId(runId)) return;
  try {
    storage.setItem(LAST_RUN_KEY, runId);
  } catch {
    /* private mode, quota, disabled cookies — this visit still navigates fine */
  }
}
