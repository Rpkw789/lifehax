/** Persistence for Evaluate's output. One row per run; re-evaluation replaces it. */

import type { Finding } from "@contracts/finding";
import type { Db } from "../../persistence/db";

export interface FindingsStore {
  save(runId: string, findings: Finding[]): Promise<void>;
  load(runId: string): Promise<Finding[] | null>;
}

export async function openFindingsStore(db: Db): Promise<FindingsStore> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS findings (
      run_id TEXT PRIMARY KEY,
      document TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  return {
    async save(runId, findings) {
      await db.query(
        `INSERT INTO findings (run_id, document, created_at) VALUES ($1, $2, $3)
         ON CONFLICT (run_id) DO UPDATE SET document = $2, created_at = $3`,
        [runId, JSON.stringify(findings), new Date().toISOString()],
      );
    },

    async load(runId) {
      const rows = await db.query<{ document: string }>(
        "SELECT document FROM findings WHERE run_id = $1",
        [runId],
      );
      return rows.length > 0 ? (JSON.parse(rows[0]!.document) as Finding[]) : null;
    },
  };
}
