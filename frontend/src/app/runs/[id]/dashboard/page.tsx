"use client";

import type { CheckResult } from "@contracts/check-result";
import checkResultFixture from "@fixtures/check-result.example.json";

import { ChevronTrack } from "@/components/ChevronTrack";
import { SectionLabel } from "@/components/SectionLabel";
import { funnelSteps } from "@/lib/funnel";
import { formatRank, formatRate, queryOutcomes } from "@/lib/scores";
import { Funnel } from "./Funnel";
import styles from "./dashboard.module.css";

// Placeholder source until the run resource is wired up. Same shape either way.
const source = checkResultFixture as unknown as CheckResult;

const SURFACE_LABELS: [keyof CheckResult["scores"]["surfaces"], string][] = [
  ["discoverability", "Search & discovery"],
  ["structured_data", "Structured product data"],
  ["agent_protocol", "Agent protocol (ACP/UCP)"],
  ["content_quality", "Content quality"],
];

export default function DashboardScreen() {
  const { scores, evaluation_config: config } = source;
  const rows = queryOutcomes(scores, config);
  const recommended = rows.filter((r) => r.recommended).length;

  return (
    <div className={styles.screen}>
      <div className={styles.column}>
        <section>
          <SectionLabel>Run results</SectionLabel>
          <div className={styles.tiles}>
            <div className={styles.tile}>
              <div className={styles.tileValue}>{formatRate(scores.hit_rate)}</div>
              <div className={styles.tileLabel}>Recommended by agents</div>
            </div>
            <div className={styles.tile}>
              <div className={styles.tileValue}>{formatRate(scores.discovery_rate)}</div>
              <div className={styles.tileLabel}>Found at all</div>
            </div>
            <div className={styles.tile}>
              <div className={styles.tileValue}>{formatRank(scores.mean_rank)}</div>
              <div className={styles.tileLabel}>Mean rank when recommended</div>
            </div>
            <div className={styles.tile}>
              <div className={styles.tileValue}>
                {recommended}/{rows.length}
              </div>
              <div className={styles.tileLabel}>Agents that recommended you</div>
            </div>
          </div>
        </section>

        <section>
          <SectionLabel>Where agents dropped out</SectionLabel>
          <Funnel steps={funnelSteps(source)} />
        </section>

        <section>
          <SectionLabel>Which prompts worked</SectionLabel>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Query</th>
                <th>Intent</th>
                <th>Found</th>
                <th>Recommended</th>
                <th>Rank</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.queryId}>
                  <td className={styles.queryText}>{row.text}</td>
                  <td>{row.intent}</td>
                  <td className={row.discovered ? styles.hit : styles.miss}>
                    {row.discovered ? "yes" : "no"}
                  </td>
                  <td className={row.recommended ? styles.hit : styles.miss}>
                    {row.recommended ? "yes" : "no"}
                  </td>
                  <td className={styles.rank}>{formatRank(row.rank)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <SectionLabel>Who outranked you</SectionLabel>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Product</th>
                <th>Times ahead</th>
              </tr>
            </thead>
            <tbody>
              {scores.competitors_ahead.map((competitor) => (
                <tr key={competitor.url}>
                  <td>
                    <a href={competitor.url} rel="noreferrer noopener" target="_blank">
                      {competitor.name}
                    </a>
                  </td>
                  <td className={styles.rank}>{competitor.times_ahead}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <SectionLabel>Surface scores</SectionLabel>
          <div className={styles.bars}>
            {SURFACE_LABELS.map(([key, label]) => (
              <div className={styles.bar} key={key}>
                <span>{label}</span>
                <ChevronTrack
                  count={20}
                  fraction={scores.surfaces[key] / 100}
                  fill="var(--ink)"
                />
                <span className={styles.barValue}>{scores.surfaces[key]}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
