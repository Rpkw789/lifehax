/**
 * Persona edits, kept per store rather than per run.
 *
 * A run's own personas are evidence and never change once it has finished —
 * these are the edits a user made on the personas screen for the *next* run of
 * the same store. One row per store host, holding the whole override list as a
 * JSON document, which is the same shape `persistence/runs.ts` uses and the
 * same narrow SQL subset both engines in `db.ts` accept.
 */

import type { Db } from "./db";
import type { PersonaOverride } from "../types";

export interface PersonaOverridesStore {
  save(storeHost: string, overrides: PersonaOverride[]): Promise<void>;
  load(storeHost: string): Promise<PersonaOverride[]>;
}

/**
 * The key a store's edits are filed under. Host only, lowercased, `www.`
 * dropped — the same store typed two ways must not end up with two sets of
 * edits, and the run pipeline looks these up from `input.storeUrl`.
 */
export function hostKey(storeUrl: string): string {
  const raw = storeUrl.trim();
  if (!raw) return "";
  let host: string;
  try {
    host = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).host;
  } catch {
    host = raw.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  }
  return host.toLowerCase().replace(/^www\./, "");
}

export async function openPersonaOverridesStore(
  db: Db,
): Promise<PersonaOverridesStore> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS persona_overrides (
      store_host TEXT PRIMARY KEY,
      document TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  return {
    async save(storeHost, overrides) {
      const key = hostKey(storeHost);
      if (!key) return;
      await db.query(
        `INSERT INTO persona_overrides (store_host, document, updated_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (store_host) DO UPDATE SET document = $2, updated_at = $3`,
        [key, JSON.stringify(overrides), new Date().toISOString()],
      );
    },

    async load(storeHost) {
      const key = hostKey(storeHost);
      if (!key) return [];
      const rows = await db.query<{ document: string }>(
        "SELECT document FROM persona_overrides WHERE store_host = $1",
        [key],
      );
      const document = rows[0]?.document;
      if (!document) return [];
      try {
        const parsed: unknown = JSON.parse(document);
        return Array.isArray(parsed) ? (parsed as PersonaOverride[]) : [];
      } catch {
        // A corrupt row must not stop a run; the generator's own briefs are a
        // complete population on their own.
        return [];
      }
    },
  };
}
