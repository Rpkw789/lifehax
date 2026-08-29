"use client";

import Link from "next/link";

import { SectionLabel } from "@/components/SectionLabel";
import { funnelFromAgents } from "@/lib/funnel";
import { useRun } from "@/lib/run-context";
import { BarList } from "@/vendor/tremor/BarList";
import { Card } from "@/vendor/tremor/Card";
import { ProgressBar } from "@/vendor/tremor/ProgressBar";
import styles from "./dashboard.module.css";
import { History } from "./History";

export default function DashboardScreen() {
  const {
    runId,
    agents,
    events,
    surfaces,
    findings,
    catalogueCount,
    running,
    complete,
    input,
  } = useRun();

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

  // A funnel is a bar list whose bars only shrink, so BarList carries it
  // without inventing a chart type Tremor does not have.
  const funnelBars = steps.map((step) => ({
    name: step.label,
    value: step.count,
  }));

  const tiles = [
    { value: `${reachedCheckout}/${agents.length}`, label: "Reached checkout" },
    { value: String(blocked), label: "Blocked before it" },
    { value: String(catalogueCount), label: "Products read" },
    { value: String(findings.length), label: "Findings raised" },
  ];

  const drops = steps.filter((s) => s.lost > 0 && s.reason);

  return (
    <div className={styles.screen}>
      <div className={styles.column}>
        <section>
          <SectionLabel>
            {running && !complete ? "Run in progress" : "Run results"}
          </SectionLabel>
          <div className={styles.tiles}>
            {tiles.map((tile) => (
              <Card key={tile.label}>
                <p className="text-2xl font-semibold text-gray-900 dark:text-gray-50">
                  {tile.value}
                </p>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  {tile.label}
                </p>
              </Card>
            ))}
          </div>
        </section>

        <section>
          <SectionLabel>Where agents dropped out</SectionLabel>
          <BarList
            data={funnelBars}
            sortOrder="none"
            valueFormatter={(v) => `${v} / ${agents.length}`}
            className="mt-3"
          />
          {drops.length > 0 ? (
            <ul className={styles.drops}>
              {drops.map((s) => (
                <li className={styles.drop} key={s.key}>
                  <span className={styles.dropCount}>
                    &minus;{s.lost} at {s.label.toLowerCase()}
                  </span>
                  <span className={styles.dropReason}>{s.reason}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section>
          <SectionLabel>Past runs for this store</SectionLabel>
          <History storeUrl={input.storeUrl} />
        </section>

        {surfaces.length > 0 ? (
          <section>
            <SectionLabel>Surface scores</SectionLabel>
            <div className={styles.surfaces}>
              {surfaces.map((surface) => (
                <div key={surface.name}>
                  <div className={styles.surfaceTop}>
                    <span className={styles.surfaceName}>{surface.name}</span>
                    <span className={styles.surfaceScore}>{surface.score}</span>
                  </div>
                  <ProgressBar value={surface.fraction * 100} className="mt-2" />
                  {surface.note ? (
                    <p className={styles.surfaceNote}>{surface.note}</p>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
