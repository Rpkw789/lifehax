/**
 * One small query interface over two engines.
 *
 * Deployed, runs live in Render's free Postgres. With no `DATABASE_URL` — a
 * fresh checkout, `bun test`, a teammate who has not provisioned anything — the
 * same code falls back to `bun:sqlite`, so the repo keeps its "works with no
 * keys at all" property.
 *
 * Both engines are held to one SQL subset: TEXT and INTEGER columns, `$1`
 * placeholders, and `ON CONFLICT (col) DO UPDATE`. Anything outside that subset
 * belongs behind a branch on `engine`, not in a statement.
 *
 * Postgres comes from Bun's built-in driver, so this adds no dependency.
 */

import { SQL } from "bun";
import { Database } from "bun:sqlite";

export type Engine = "postgres" | "sqlite";

/** Everything a store may bind. Deliberately narrow — documents are stringified. */
export type Param = string | number | null;

export interface Db {
  readonly engine: Engine;
  /** Rows as objects. Placeholders are `$1`, `$2`, ... on both engines. */
  query<T>(text: string, params?: readonly Param[]): Promise<T[]>;
  /** A single DDL statement. No parameters, no rows. */
  exec(text: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * Postgres when `DATABASE_URL` is set, otherwise SQLite at `sqlitePath`.
 * Pass `":memory:"` for a throwaway database in tests.
 */
export function openDb(
  url: string | undefined = process.env.DATABASE_URL,
  sqlitePath = "happy2.sqlite",
): Db {
  const trimmed = url?.trim();
  return trimmed ? openPostgres(trimmed) : openSqlite(sqlitePath);
}

function openPostgres(url: string): Db {
  // Render's `connectionString` is the in-region internal URL, which needs no
  // sslmode. An external URL carries its own ?sslmode=require, so neither case
  // wants us appending anything here.
  const sql = new SQL(url);
  return {
    engine: "postgres",
    async query<T>(text: string, params: readonly Param[] = []): Promise<T[]> {
      return (await sql.unsafe(text, params as Param[])) as T[];
    },
    async exec(text: string): Promise<void> {
      await sql.unsafe(text);
    },
    async close() {
      await sql.close();
    },
  };
}

function openSqlite(path: string): Db {
  const db = new Database(path);
  return {
    engine: "sqlite",
    async query<T>(text: string, params: readonly Param[] = []): Promise<T[]> {
      return db.query(toSqlitePlaceholders(text)).all(...params) as T[];
    },
    async exec(text: string): Promise<void> {
      db.run(text);
    },
    async close() {
      db.close();
    },
  };
}

/**
 * Postgres `$1` becomes bun:sqlite `?1`.
 *
 * Sound only because no statement in this repo contains a `$` inside a string
 * literal. Do not route arbitrary or user-supplied SQL through here.
 */
function toSqlitePlaceholders(text: string): string {
  return text.replace(/\$(\d+)/g, "?$1");
}
