/** Persistence for Evaluate's output. One row per run; re-evaluation replaces it. */

import { Database } from "bun:sqlite";
import type { Finding } from "@contracts/finding";

export interface FindingsStore {
  save(runId: string, findings: Finding[]): void;
  load(runId: string): Finding[] | null;
}

export function openFindingsStore(path = "happy2.sqlite"): FindingsStore {
  const db = new Database(path);
  db.run(`
    CREATE TABLE IF NOT EXISTS findings (
      run_id TEXT PRIMARY KEY,
      document TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  return {
    save(runId, findings) {
      db.query(
        `INSERT INTO findings (run_id, document, created_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(run_id) DO UPDATE SET document = ?2, created_at = ?3`,
      ).run(runId, JSON.stringify(findings), new Date().toISOString());
    },

    load(runId) {
      const row = db.query("SELECT document FROM findings WHERE run_id = ?1").get(runId) as
        | { document: string }
        | null;
      return row ? (JSON.parse(row.document) as Finding[]) : null;
    },
  };
}
