"use client";

import { useRouter } from "next/navigation";

import { Button } from "@/components/Button";
import { ChevronTrack } from "@/components/ChevronTrack";
import { SectionLabel } from "@/components/SectionLabel";
import { FINDINGS, PERSONAS, STAGES, SURFACE_SCORES } from "@/lib/fixtures";
import { useRun } from "@/lib/run-context";
import { TOTAL_TICKS, agentStates } from "@/lib/simulation";
import type { Severity } from "@/lib/types";
import styles from "./recommend.module.css";

const SEV_CLASS: Record<Severity, string> = {
  critical: styles.sevCritical,
  high: styles.sevHigh,
  medium: styles.sevMedium,
};

function Caret({ open }: { open: boolean }) {
  return (
    <span className={`${styles.caret} ${open ? styles.caretOpen : ""}`}>
      <svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden="true"
      >
        <path d="M3 4.5L6 7.5L9 4.5" />
      </svg>
    </span>
  );
}

export default function RecommendScreen() {
  const router = useRouter();
  const { runId, openFindings, toggleFinding, startRun } = useRun();

  // This screen reads a finished run, so it derives from the final tick
  // regardless of where the clock happens to be sitting.
  const agents = agentStates(TOTAL_TICKS);

  return (
    <div className={styles.screen}>
      <div className={styles.column}>
        <div className={styles.scoreHeader}>
          <div className={styles.scoreSide}>
            <SectionLabel>AI readiness</SectionLabel>
            <div className={styles.scoreValue}>
              <span className={styles.score}>42</span>
              <span className={styles.scoreMax}>/100</span>
            </div>
            <div className={styles.verdict}>Partially reachable</div>
          </div>

          <div className={styles.summarySide}>
            <p className={styles.summary}>
              Three of ten agents completed a purchase. Every failure sat in one
              of two places: product facts an agent could not read without
              vision, and a checkout that assumes a human with an account.
              Neither needs a redesign — both are additive.
            </p>
            <div className={styles.summaryActions}>
              <Button>Export findings</Button>
              <Button
                variant="outlineSoft"
                onClick={() => {
                  startRun();
                  router.push(`/runs/${runId}/check`);
                }}
              >
                Re-run simulation
              </Button>
            </div>
          </div>
        </div>

        <div className={styles.surfaces}>
          {SURFACE_SCORES.map((surface) => (
            <div key={surface.name} className={styles.surfaceCard}>
              <div className={styles.surfaceTop}>
                <span className={styles.surfaceName}>{surface.name}</span>
                <span className={styles.surfaceScore}>{surface.score}</span>
              </div>
              <ChevronTrack
                className={styles.surfaceTrack}
                count={18}
                fraction={surface.fraction}
                fill="var(--ink)"
              />
              <div className={styles.surfaceNote}>{surface.note}</div>
            </div>
          ))}
        </div>

        <SectionLabel className={styles.matrixLabel}>
          Where each brief died
        </SectionLabel>
        <div className={styles.matrix}>
          <div className={styles.matrixHead}>
            <div
              className={`${styles.matrixBriefCell} ${styles.matrixHeadCell}`}
            >
              Brief
            </div>
            <div className={styles.matrixStages}>
              {STAGES.map((stage) => (
                <div key={stage} className={styles.matrixHeadCell}>
                  {stage}
                </div>
              ))}
            </div>
          </div>

          {PERSONAS.map((persona, personaIndex) => {
            const group = agents.filter((a) => a.personaIndex === personaIndex);
            return (
              <div key={persona.tag} className={styles.matrixRow}>
                <div className={styles.matrixBrief}>
                  <span
                    className={styles.matrixSwatch}
                    style={{ background: persona.color }}
                  />
                  <span className={styles.matrixName}>{persona.name}</span>
                </div>
                <div className={styles.matrixStages}>
                  {STAGES.map((stage, stageIndex) => {
                    const cleared = group.filter(
                      (a) => a.progress >= stageIndex + 1,
                    ).length;
                    return (
                      <div
                        key={stage}
                        className={`${styles.cell} ${
                          cleared === 2
                            ? styles.cellBoth
                            : cleared === 1
                              ? styles.cellOne
                              : styles.cellNone
                        }`}
                      >
                        {cleared === 2 ? "●●" : cleared === 1 ? "●○" : "○○"}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          <div className={styles.matrixFoot}>
            2 agents per brief · glyph shows how many cleared the stage
          </div>
        </div>

        <SectionLabel className={styles.findingsLabel}>
          Recommendations · ordered by agents unblocked
        </SectionLabel>
        <div className={styles.findings}>
          {FINDINGS.map((finding) => {
            const open = !!openFindings[finding.key];
            return (
              <div key={finding.key} className={styles.finding}>
                <button
                  type="button"
                  className={styles.findingHeader}
                  onClick={() => toggleFinding(finding.key)}
                  aria-expanded={open}
                >
                  <span
                    className={`${styles.sev} ${SEV_CLASS[finding.severity]}`}
                  >
                    {finding.severity}
                  </span>
                  <span className={styles.findingText}>
                    <span className={styles.findingTitle}>{finding.title}</span>
                    <span className={styles.evidence}>{finding.evidence}</span>
                  </span>
                  <span className={styles.findingMeta}>
                    <span className={styles.impact}>{finding.impact}</span>
                    <Caret open={open} />
                  </span>
                </button>

                {open && (
                  <div className={styles.findingBody}>
                    <div className={styles.findingGrid}>
                      <div>
                        <SectionLabel>What to change</SectionLabel>
                        <p className={styles.fix}>{finding.fix}</p>
                        <div className={styles.metaPairs}>
                          {(
                            [
                              ["Surface", finding.surface],
                              ["Effort", finding.effort],
                              ["Owner", finding.owner],
                            ] as const
                          ).map(([key, value]) => (
                            <span key={key} className={styles.metaPair}>
                              <span className={styles.metaKey}>{key}</span>
                              <span className={styles.metaValue}>{value}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                      <div>
                        <SectionLabel>{finding.snippetLabel}</SectionLabel>
                        <pre className={styles.snippet}>{finding.snippet}</pre>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
