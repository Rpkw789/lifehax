/**
 * Saved runs. One row per run, written once when the run stops.
 *
 * The whole `Run` goes in as a JSON document so a saved run rehydrates the
 * existing screens verbatim; the columns beside it exist purely so the history
 * list can be built without parsing every document.
 *
 * Nothing here may hold a brand credential (AGENTS.md rule 6). `RunInput`
 * carries none today — if a key is ever added to it, strip it in `forStorage`.
 */

import type { Db } from "./db";
import type { Run, RunStatus } from "../types";

/** A row of the history list. Everything but the document. */
export interface RunSummary {
  runId: string;
  storeUrl: string;
  status: RunStatus;
  createdAt: string;
  findings: number;
  blocked: number;
}

export interface RunsStore {
  save(run: Run): Promise<void>;
  list(limit?: number): Promise<RunSummary[]>;
  load(runId: string): Promise<Run | null>;
}

export async function openRunsStore(db: Db): Promise<RunsStore> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      run_id TEXT PRIMARY KEY,
      store_url TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      findings INTEGER NOT NULL,
      blocked INTEGER NOT NULL,
      document TEXT NOT NULL
    )
  `);

  return {
    async save(run) {
      const blocked = run.events.filter((e) => e.kind === "fail").length;
      await db.query(
        `INSERT INTO runs (run_id, store_url, status, created_at, findings, blocked, document)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (run_id) DO UPDATE SET
           status = $3, findings = $5, blocked = $6, document = $7`,
        [
          run.runId,
          run.input.storeUrl,
          run.status,
          run.createdAt,
          run.findings.length,
          blocked,
          JSON.stringify(forStorage(run)),
        ],
      );
    },

    async list(limit = 50) {
      const rows = await db.query<{
        run_id: string;
        store_url: string;
        status: RunStatus;
        created_at: string;
        findings: number;
        blocked: number;
      }>(
        `SELECT run_id, store_url, status, created_at, findings, blocked
         FROM runs ORDER BY created_at DESC LIMIT $1`,
        [limit],
      );
      return rows.map((row) => ({
        runId: row.run_id,
        storeUrl: row.store_url,
        status: row.status,
        createdAt: row.created_at,
        findings: Number(row.findings),
        blocked: Number(row.blocked),
      }));
    },

    async load(runId) {
      const rows = await db.query<{ document: string }>(
        "SELECT document FROM runs WHERE run_id = $1",
        [runId],
      );
      return rows.length > 0 ? (JSON.parse(rows[0]!.document) as Run) : null;
    },
  };
}

/**
 * A reloaded run is over by definition, so its live views are dead. Browserbase
 * returns 410 for a stopped session and the URL renders a "debugging connection
 * was closed" page, so the sessions are dropped rather than replayed.
 */
function forStorage(run: Run): Run {
  return { ...run, sessions: {}, sessionsClosed: true };
}
