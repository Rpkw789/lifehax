/**
 * Logging.
 *
 * Every outbound call the backend makes should be visible here, because when a
 * run produces a surprising finding the first question is always "what did we
 * actually fetch, and what came back".
 *
 * Never log a credential. Keys are read from the environment and passed
 * straight to the client that needs them; no header, token or API key may
 * appear in a log line (AGENTS.md hard rule 6).
 *
 *   LOG_LEVEL=debug|info|warn|error   default info
 *   LOG_HTTP=0                        silence the per-fetch lines
 */

type Level = "debug" | "info" | "warn" | "error";

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const LEVEL = (process.env.LOG_LEVEL ?? "info") as Level;
const THRESHOLD = ORDER[LEVEL] ?? ORDER.info;
export const LOG_HTTP = process.env.LOG_HTTP !== "0";

const COLOR: Record<Level, string> = {
  debug: "\x1b[90m",
  info: "\x1b[36m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
};
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";

function stamp(): string {
  return new Date().toISOString().slice(11, 23);
}

function emit(level: Level, scope: string, message: string, extra?: unknown): void {
  if (ORDER[level] < THRESHOLD) return;
  const head = `${DIM}${stamp()}${RESET} ${COLOR[level]}${level.padEnd(5)}${RESET} ${DIM}${scope}${RESET}`;
  if (extra === undefined) {
    console.log(`${head} ${message}`);
  } else {
    console.log(`${head} ${message} ${format(extra)}`);
  }
}

/** Compact one-line rendering; falls back to inspect for anything odd. */
function format(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === "string") return value;
  try {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
      .join(" ");
  } catch {
    return String(value);
  }
}

export interface Logger {
  debug(message: string, extra?: unknown): void;
  info(message: string, extra?: unknown): void;
  warn(message: string, extra?: unknown): void;
  error(message: string, extra?: unknown): void;
  /** A logger tagged with a run id, so concurrent runs stay readable. */
  child(scope: string): Logger;
}

export function logger(scope: string): Logger {
  return {
    debug: (m, e) => emit("debug", scope, m, e),
    info: (m, e) => emit("info", scope, m, e),
    warn: (m, e) => emit("warn", scope, m, e),
    error: (m, e) => emit("error", scope, m, e),
    child: (sub) => logger(`${scope}:${sub}`),
  };
}

/** Milliseconds since a mark, for the `ms=` fields below. */
export function since(startMs: number): number {
  return Date.now() - startMs;
}

export const log = logger("happy2");
