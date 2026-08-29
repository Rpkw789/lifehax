"use client";

import { useEffect, useState } from "react";

import { ChevronTrack } from "@/components/ChevronTrack";
import { listRuns } from "@/lib/api";
import { iterationsFor, type Iteration } from "@/lib/history";
import styles from "./History.module.css";

/** Chevrons in a count track. A run with more than this reads as "many". */
const SCALE = 12;

/**
 * Successive runs against this store.
 *
 * Two runs is the minimum that says anything, so a single run gets a sentence
 * rather than a chart — one bar pretending to be a trend is worse than an
 * honest note.
 */
export function History({ storeUrl }: { storeUrl: string }) {
  const [iterations, setIterations] = useState<Iteration[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    listRuns()
      .then((runs) => {
        if (live) setIterations(iterationsFor(runs, storeUrl));
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : "could not read past runs");
      });
    return () => {
      live = false;
    };
  }, [storeUrl]);

  if (error) return <p className={styles.note}>Past runs unavailable — {error}.</p>;
  if (iterations === null) return <p className={styles.note}>Reading past runs…</p>;

  if (iterations.length < 2) {
    return (
      <p className={styles.note}>
        {iterations.length === 0
          ? "No finished runs saved for this store yet."
          : "One run so far. Run this store again after a fix and the change appears here."}
      </p>
    );
  }

  return (
    <div className={styles.rows}>
      {iterations.map((run, i) => (
        <div
          className={`${styles.row} ${i === iterations.length - 1 ? styles.latest : ""}`}
          key={run.runId}
        >
          <span className={styles.when}>{formatWhen(run.createdAt)}</span>
          <Metric
            value={run.findings}
            unit={run.findings === 1 ? "finding" : "findings"}
            delta={run.findingsDelta}
          />
          <Metric
            value={run.blocked}
            unit="blocked"
            delta={run.blockedDelta}
          />
        </div>
      ))}
    </div>
  );
}

function Metric({
  value,
  unit,
  delta,
}: {
  value: number;
  unit: string;
  delta: number | null;
}) {
  return (
    <span className={styles.metric}>
      <ChevronTrack
        count={SCALE}
        fraction={Math.min(1, value / SCALE)}
        fill="var(--ink)"
      />
      <span className={styles.count}>
        {value} <span className={styles.unit}>{unit}</span>
      </span>
      <span className={`${styles.delta} ${deltaClass(delta)}`}>{formatDelta(delta)}</span>
    </span>
  );
}

/** Fewer is better here, so a negative delta is the good one. */
function deltaClass(delta: number | null): string {
  if (delta === null || delta === 0) return styles.same;
  return delta < 0 ? styles.better : styles.worse;
}

function formatDelta(delta: number | null): string {
  if (delta === null) return "";
  if (delta === 0) return "same";
  return delta < 0 ? `−${Math.abs(delta)}` : `+${delta}`;
}

function formatWhen(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return at.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
