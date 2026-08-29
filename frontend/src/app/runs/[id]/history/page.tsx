"use client";

import Link from "next/link";

import { useRun } from "@/lib/run-context";
import styles from "../sections.module.css";

/**
 * Past runs.
 *
 * There is no run store behind this yet — the backend keeps a run for the life
 * of the process and nothing writes a history. So every row below the current
 * one is invented, the screen says so, and the hosts are `.example` rather than
 * anything that could be mistaken for a real store.
 *
 * When a run store lands, this reads it and the constant goes away.
 */
interface PastRun {
  id: string;
  when: string;
  store: string;
  agents: number;
  hitRate: string;
  findings: number;
}

const PAST_RUNS: readonly PastRun[] = [
  { id: "2041", when: "27 Aug 14:02", store: "northbay.example", agents: 10, hitRate: "40%", findings: 6 },
  { id: "2038", when: "26 Aug 09:41", store: "atlas-supply.example", agents: 10, hitRate: "20%", findings: 9 },
  { id: "2035", when: "22 Aug 16:20", store: "northbay.example", agents: 10, hitRate: "10%", findings: 11 },
  { id: "2030", when: "19 Aug 11:07", store: "verity-goods.example", agents: 6, hitRate: "50%", findings: 4 },
];

export default function HistoryScreen() {
  const { runId, storeHost, agents, complete } = useRun();

  const won = agents.filter((a) => a.ok).length;
  const currentHitRate = complete
    ? `${Math.round((won / Math.max(1, agents.length)) * 100)}%`
    : "—";

  return (
    <div className={styles.screen}>
      <div className={styles.note}>
        The current run, then earlier audits on this workspace.
        <span className={styles.sim}>mock data</span>
      </div>

      <div className={styles.list}>
        <div className={`${styles.runRow} ${styles.runRowHead}`}>
          <span className={styles.headCell}>When</span>
          <span className={styles.headCell}>Store</span>
          <span className={styles.headCell}>Agents</span>
          <span className={styles.headCell}>Hit rate</span>
          <span className={styles.headCell}>Findings</span>
        </div>

        <Link
          className={`${styles.runRow} ${styles.runRowCurrent}`}
          href={`/runs/${runId}/check`}
        >
          <span className={styles.runWhen}>now</span>
          <span className={styles.runStore}>{storeHost}</span>
          <span className={styles.runFigure}>{agents.length}</span>
          <span className={styles.runFigure}>{currentHitRate}</span>
          <span className={styles.runBadge}>
            {complete ? "complete" : "this run"}
          </span>
        </Link>

        {/* Not links: there is nothing behind them to open. */}
        {PAST_RUNS.map((run) => (
          <div key={run.id} className={styles.runRow}>
            <span className={styles.runWhen}>{run.when}</span>
            <span className={styles.runStore}>{run.store}</span>
            <span className={styles.runFigure}>{run.agents}</span>
            <span className={styles.runFigure}>{run.hitRate}</span>
            <span className={styles.runFigure}>{run.findings}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
