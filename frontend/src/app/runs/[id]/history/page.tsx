"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { listRuns } from "@/lib/api";
import type { RunSummary } from "@/lib/history";
import { useRun } from "@/lib/run-context";
import styles from "../sections.module.css";

/**
 * Past runs.
 *
 * Reads the run store the backend now keeps, so these are real audits rather
 * than a placeholder list — newest first, each one openable. A run that errored
 * measured nothing, so it is shown with its status rather than a hit count that
 * would imply it produced one.
 */
export default function HistoryScreen() {
  const { runId } = useRun();
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    listRuns()
      .then((result) => {
        if (live) setRuns(result);
      })
      .catch((err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className={styles.screen}>
      <div className={styles.note}>
        {error
          ? `Could not reach the backend — ${error}`
          : runs === null
            ? "Loading runs…"
            : `${runs.length} ${runs.length === 1 ? "run" : "runs"} on this workspace`}
      </div>

      {runs !== null && runs.length > 0 && (
        <div className={styles.list}>
          <div className={`${styles.runRow} ${styles.runRowHead}`}>
            <span className={styles.headCell}>Started</span>
            <span className={styles.headCell}>Store</span>
            <span className={styles.headCell}>Findings</span>
            <span className={styles.headCell}>Blocked</span>
            <span className={styles.headCell}>Status</span>
          </div>

          {runs.map((run) => (
            <Link
              key={run.runId}
              className={`${styles.runRow} ${
                run.runId === runId ? styles.runRowCurrent : ""
              }`}
              href={`/runs/${run.runId}/dashboard`}
            >
              <span className={styles.runWhen}>{when(run.createdAt)}</span>
              <span className={styles.runStore}>{host(run.storeUrl)}</span>
              <span className={styles.runFigure}>{run.findings}</span>
              <span className={styles.runFigure}>{run.blocked}</span>
              <span
                className={
                  run.runId === runId ? styles.runBadge : styles.runFigure
                }
              >
                {run.runId === runId ? "this run" : run.status}
              </span>
            </Link>
          ))}
        </div>
      )}

      {runs !== null && runs.length === 0 && (
        <div className={styles.card}>
          <div className={styles.capNote}>
            No runs saved yet. Finish one and it will appear here.
          </div>
        </div>
      )}
    </div>
  );
}

/** `27 Aug 14:02`, or the raw value if it will not parse. */
function when(createdAt: string): string {
  const at = new Date(createdAt);
  if (Number.isNaN(at.getTime())) return createdAt;
  return at.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Host only, so the column stays readable. */
function host(storeUrl: string): string {
  const raw = storeUrl.trim();
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).host;
  } catch {
    return raw;
  }
}
