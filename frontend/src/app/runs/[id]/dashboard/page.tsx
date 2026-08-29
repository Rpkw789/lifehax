"use client";

import Link from "next/link";

import { ChevronTrack } from "@/components/ChevronTrack";
import { SectionLabel } from "@/components/SectionLabel";
import { funnelFromAgents } from "@/lib/funnel";
import { useRun } from "@/lib/run-context";
import styles from "./dashboard.module.css";
import { Funnel } from "./Funnel";

export default function DashboardScreen() {
  const { runId, agents, events, surfaces, findings, catalogueCount, running, complete } =
    useRun();

  // The provider seeds a full agent population before anything runs, so an
  // empty `agents` never signals "no run" — an empty event stream does.
  if (events.length === 0 && !running && !complete) {
    return (
      <div className={styles.screen}>
        <div className={styles.column}>
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>No run yet</p>
            <p className={styles.emptyBody}>
              Start a run from Input and the results appear here.
            </p>
            <Link className={styles.emptyLink} href={`/runs/${runId}/input`}>
              Go to Input
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const steps = funnelFromAgents(agents);
  const settled = agents.filter((a) => a.settled);
  const reachedCheckout = agents.filter((a) => a.progress >= 6).length;
  const blocked = settled.filter((a) => a.blocked).length;

  return (
    <div className={styles.screen}>
      <div className={styles.column}>
        <section>
          <SectionLabel>
            {complete ? "Run results" : running ? "Run in progress" : "Run results"}
          </SectionLabel>
          <div className={styles.tiles}>
            <div className={styles.tile}>
              <div className={styles.tileValue}>
                {reachedCheckout}
                <span className={styles.tileOf}>/{agents.length}</span>
              </div>
              <div className={styles.tileLabel}>Reached checkout</div>
            </div>
            <div className={styles.tile}>
              <div className={styles.tileValue}>{blocked}</div>
              <div className={styles.tileLabel}>Blocked before it</div>
            </div>
            <div className={styles.tile}>
              <div className={styles.tileValue}>{catalogueCount}</div>
              <div className={styles.tileLabel}>Products read</div>
            </div>
            <div className={styles.tile}>
              <div className={styles.tileValue}>{findings.length}</div>
              <div className={styles.tileLabel}>Findings raised</div>
            </div>
          </div>
        </section>

        <section>
          <SectionLabel>Where agents dropped out</SectionLabel>
          <Funnel steps={steps} />
        </section>

        {surfaces.length > 0 ? (
          <section>
            <SectionLabel>Surface scores</SectionLabel>
            <div className={styles.bars}>
              {surfaces.map((surface) => (
                <div className={styles.bar} key={surface.name}>
                  <span>{surface.name}</span>
                  <ChevronTrack count={18} fraction={surface.fraction} fill="var(--ink)" />
                  <span className={styles.barValue}>{surface.score}</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
