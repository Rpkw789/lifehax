"use client";

import Link from "next/link";

import { SectionLabel } from "@/components/SectionLabel";
import { funnelFromAgents } from "@/lib/funnel";
import { useRun } from "@/lib/run-context";
import { Attrition } from "./Attrition";
import { SurfaceRadar } from "./SurfaceRadar";
import styles from "./dashboard.module.css";
import { History } from "./History";

export default function DashboardScreen() {
  const {
    runId,
    restore,
    agents,
    events,
    surfaces,
    findings,
    catalogueCount,
    running,
    complete,
    input,
  } = useRun();

  // Reading a saved run takes a round trip, and "No run yet" is the wrong
  // thing to say while the answer is still coming.
  if (restore === "pending") {
    return (
      <div className={styles.screen}>
        <div className={styles.column}>
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>Reading this run…</p>
          </div>
        </div>
      </div>
    );
  }

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

  return (
    <div className={styles.screen}>
      <div className={styles.column}>
        {/* The hero: where shoppers are lost. Everything else is context. */}
        <section className={styles.hero}>
          <Attrition steps={steps} total={agents.length} />
        </section>

        {/* The trend belongs beside the headline: the number only means
            something against the last run's number. */}
        <section>
          <SectionLabel>Past runs for this store</SectionLabel>
          <History storeUrl={input.storeUrl} />
        </section>

        {/* One line of context, rather than four tiles competing with the hero. */}
        <p className={styles.context}>
          {catalogueCount} products read
          <span className={styles.sep}>·</span>
          {findings.length} {findings.length === 1 ? "finding" : "findings"} raised
          <span className={styles.sep}>·</span>
          {running && !complete ? "run in progress" : "run complete"}
        </p>

        {surfaces.length > 0 ? (
          <section>
            <SectionLabel>Surface scores</SectionLabel>
            <SurfaceRadar surfaces={surfaces} />
          </section>
        ) : null}
      </div>
    </div>
  );
}
