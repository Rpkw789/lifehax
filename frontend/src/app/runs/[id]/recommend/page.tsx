"use client";

import { useRouter } from "next/navigation";

import { Button } from "@/components/Button";
import { ChevronTrack } from "@/components/ChevronTrack";
import { SectionLabel } from "@/components/SectionLabel";
import { STAGES } from "@/lib/fixtures";
import {
  buildFindingsMarkdown,
  buildRunJson,
  downloadFile,
  exportBasename,
  type RunExport,
} from "@/lib/export";
import {
  exposureScore,
  exposureVerdictFor,
  overallScore,
  verdictFor,
} from "@/lib/readiness";
import { useRun } from "@/lib/run-context";
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
  const {
    runId,
    openFindings,
    toggleFinding,
    agents,
    personas,
    findings,
    surfaces,
    input,
    catalogueCount,
  } = useRun();

  // The headline is the bot-defence reading; the surface mean is a separate
  // fact and keeps its own label on the cards below.
  const score = exposureScore(agents);
  const verdict = exposureVerdictFor(score);
  const surfaceScore = overallScore(surfaces);
  const settled = agents.filter((a) => a.settled);
  const completed = agents.filter((a) => a.ok).length;
  const blocked = settled.filter((a) => a.blocked);

  function snapshot(): RunExport {
    return {
      runId,
      storeUrl: input.storeUrl,
      exportedAt: new Date().toISOString(),
      catalogueCount,
      defence: { score, verdict },
      surfaceReadability: {
        score: surfaceScore,
        verdict: verdictFor(surfaceScore),
      },
      agents: agents.map((a) => ({
        id: a.id,
        persona: a.persona.name,
        stagesCleared: a.progress,
        outcome: a.ok ? "completed" : a.blocked ? "blocked" : "running",
        ...(a.reason ? { reason: a.reason } : {}),
      })),
      surfaces: [...surfaces],
      findings: [...findings],
    };
  }

  function exportAs(kind: "json" | "md"): void {
    const run = snapshot();
    const base = exportBasename(run.storeUrl, run.exportedAt);
    if (kind === "json") {
      downloadFile(`${base}.json`, "application/json", buildRunJson(run));
    } else {
      downloadFile(`${base}.md`, "text/markdown", buildFindingsMarkdown(run));
    }
  }

  return (
    <div className={styles.screen}>
      <div className={styles.column}>
        <div className={styles.scoreHeader}>
          <div className={styles.scoreSide}>
            <SectionLabel>Bot exposure</SectionLabel>
            <div className={styles.scoreValue}>
              <span className={styles.score}>{score}</span>
              <span className={styles.scoreMax}>/100</span>
            </div>
            <div className={styles.verdict}>{verdict}</div>
          </div>

          <div className={styles.summarySide}>
            <p className={styles.summary}>
              {settled.length === 0
                ? "No agent has settled yet."
                : completed === 0
                  ? `Every one of the ${settled.length} settled agents was stopped before checkout.`
                  : `${completed} of ${agents.length} bot agents completed a purchase unchallenged.` +
                    (blocked.length > 0
                      ? ` ${blocked.length} were stopped, the first at ${blocked[0]?.reason ?? "an earlier stage"}.`
                      : " Nothing on the storefront interrupted any of them.")}
            </p>
            <div className={styles.summaryActions}>
              <Button onClick={() => exportAs("md")}>Export report</Button>
              <Button
                variant="outline"
                onClick={() => router.push(`/runs/${runId}/dashboard`)}
              >
                View dashboard
              </Button>
              <Button variant="outlineSoft" onClick={() => exportAs("json")}>
                Export JSON
              </Button>
              <Button
                variant="outlineSoft"
                onClick={() => router.push(`/runs/${runId}/input`)}
              >
                New run
              </Button>
            </div>
          </div>
        </div>

        {/* A separate measurement from the headline: what a crawler can
            parse, which is not the same question as whether a bot gets
            through. Labelled so the two are not read as one score. */}
        <SectionLabel className={styles.matrixLabel}>
          Machine readability · from the fetch audit
        </SectionLabel>
        <div className={styles.surfaces}>
          {surfaces.map((surface) => (
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
          How far each brief got before something stopped it
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

          {personas.map((persona, personaIndex) => {
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
            2 agents per brief · glyph shows how many got through · fewer is better
          </div>
        </div>

        <SectionLabel className={styles.findingsLabel}>
          Recommendations · ordered by agents let through
        </SectionLabel>
        <div className={styles.findings}>
          {findings.map((finding) => {
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
