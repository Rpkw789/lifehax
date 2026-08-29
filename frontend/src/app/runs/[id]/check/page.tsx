"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/Button";
import { ChevronTrack } from "@/components/ChevronTrack";
import { SectionLabel } from "@/components/SectionLabel";
import { STAGES } from "@/lib/fixtures";
import { useRun } from "@/lib/run-context";
import { elapsedLabel, logText } from "@/lib/simulation";
import { ramp } from "@/lib/tokens";
import motion from "@/styles/motion.module.css";
import styles from "./check.module.css";
import { LivestreamTile } from "./LivestreamTile";

export default function CheckScreen() {
  const router = useRouter();
  const {
    runId,
    storeHost,
    tick,
    running,
    complete,
    error,
    startRun,
    agents,
    events,
    personas,
    sessions,
    tileIds,
  } = useRun();
  const started = useRef(false);

  // Landing on this URL directly should start the run rather than sit dead.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!running && !complete) startRun();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const settled = agents.filter((a) => a.settled).length;
  const won = agents.filter((a) => a.ok).length;
  const hitRate = Math.round((won / agents.length) * 100);

  const tiles = tileIds
    .map((id) => agents.find((a) => a.id === id))
    .filter((a): a is NonNullable<typeof a> => a !== undefined);

  const stats: [string, string][] = [
    ["Elapsed", elapsedLabel(tick)],
    ["Agents settled", `${settled}/${agents.length}`],
    ["Checkout hit rate", `${hitRate}%`],
  ];

  return (
    <div className={styles.screen}>
      <div className={styles.main}>
        <div className={styles.runStrip}>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Target</span>
            <span className={styles.statValue}>{storeHost}</span>
          </div>
          {stats.map(([label, value]) => (
            <div key={label} className={styles.stat}>
              <span className={styles.statLabel}>{label}</span>
              <span className={styles.statValue}>{value}</span>
            </div>
          ))}
          <div className={styles.runState}>
            <span
              className={`${styles.liveDot} ${
                complete ? styles.liveDotSettled : motion.dotBlink
              }`}
            />
            <span className={styles.runStateWord}>
              {complete ? "settled" : "running"}
            </span>
          </div>
        </div>

        {error && (
          <div className={styles.banner}>
            <div className={styles.bannerText}>Run failed — {error}</div>
          </div>
        )}

        {complete && !error && (
          <div className={styles.banner}>
            <div className={styles.bannerText}>
              Simulation complete — {won} of {agents.length} agents completed a
              purchase
            </div>
            <Button
              className={styles.bannerPrimary}
              onClick={() => router.push(`/runs/${runId}/recommend`)}
            >
              View recommendations
            </Button>
            <Button
              variant="outline"
              onClick={() => router.push(`/runs/${runId}/input`)}
            >
              New run
            </Button>
          </div>
        )}

        <SectionLabel className={styles.stagesLabel}>
          Journey stages · agents reaching each
        </SectionLabel>
        <div className={styles.stages}>
          {STAGES.map((stage, stageIndex) => {
            const reached = agents.filter(
              (a) => a.progress >= stageIndex + 1,
            ).length;
            const blocked = agents.filter(
              (a) => a.fail === stageIndex + 1 && a.settled,
            ).length;
            return (
              <div
                key={stage}
                className={`${styles.stageCard} ${
                  blocked > 0 ? styles.stageCardBlocked : ""
                }`}
              >
                <div className={styles.stageTop}>
                  <span className={styles.stageName}>{stage}</span>
                  <span className={styles.stageCount}>
                    {reached}/{agents.length}
                  </span>
                </div>
                <ChevronTrack
                  className={styles.stageTrack}
                  count={10}
                  fraction={reached / agents.length}
                  fill={ramp(stageIndex, STAGES.length)}
                />
                <div className={styles.stageNote}>
                  {blocked > 0
                    ? `${blocked} blocked here`
                    : reached === agents.length
                      ? "clean"
                      : "in flight"}
                </div>
              </div>
            );
          })}
        </div>

        <SectionLabel className={styles.livestreamLabel}>
          Livestream · {tiles.length} of {agents.length} sessions · {personas.length} briefs
        </SectionLabel>
        <div className={styles.livestream}>
          {tiles.map((agent) => (
            <LivestreamTile
              key={agent.id}
              agent={agent}
              storeHost={storeHost}
              liveViewUrl={sessions[agent.id]}
              events={events.filter((e) => e.agentId === agent.id)}
            />
          ))}
        </div>

        <SectionLabel className={styles.boardLabel}>
          Stage board · every agent
        </SectionLabel>
        <div className={styles.board}>
          <div className={styles.boardHead}>
            <div className={`${styles.boardAgentCell} ${styles.boardHeadCell}`}>
              Agent
            </div>
            <div className={styles.boardStages}>
              {STAGES.map((stage) => (
                <div key={stage} className={styles.boardHeadCell}>
                  {stage}
                </div>
              ))}
            </div>
            <div
              className={`${styles.boardOutcomeCell} ${styles.boardHeadCell}`}
            >
              Outcome
            </div>
          </div>

          {agents.map((agent) => (
            <div
              key={agent.id}
              className={`${styles.boardRow} ${
                agent.blocked ? styles.boardRowBlocked : ""
              }`}
            >
              <div className={styles.boardAgent}>
                <span
                  className={`${styles.agentSwatch} ${
                    agent.settled ? "" : motion.swatchBlink
                  }`}
                  style={{ background: agent.persona.color }}
                />
                <span className={styles.agentId}>{agent.id}</span>
                <span className={styles.agentTag}>{agent.persona.tag}</span>
              </div>
              {/* Desaturating to grey once blocked is the signal. */}
              <ChevronTrack
                className={styles.boardTrack}
                count={30}
                fraction={agent.progress / STAGES.length}
                fill={agent.blocked ? "var(--blocked)" : agent.persona.color}
              />
              <div
                className={`${styles.outcome} ${
                  agent.settled ? styles.outcomeSettled : ""
                }`}
              >
                {agent.blocked
                  ? `blocked · ${STAGES[agent.fail - 1]}`
                  : agent.ok
                    ? "checkout complete"
                    : `${STAGES[Math.min(5, agent.progress)]}…`}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.console}>
        <div className={styles.consoleHead}>
          <SectionLabel>Console</SectionLabel>
          <span className={styles.consoleCount}>{events.length} events</span>
        </div>
        <div className={styles.consoleList}>
          {/* Newest first, capped at 16. */}
          {events
            .slice(-16)
            .reverse()
            .map((event) => (
              <div
                key={`${event.agentId}-${event.stage}-${event.kind}`}
                className={styles.consoleEntry}
              >
                <span className={styles.consoleTime}>
                  {elapsedLabel(event.t)}
                </span>
                <span
                  className={styles.consoleBadge}
                  style={{
                    background:
                      agents.find((a) => a.id === event.agentId)?.persona
                        .color ?? "var(--border-strong)",
                  }}
                >
                  {event.agentId}
                </span>
                <span
                  className={`${styles.consoleMessage} ${
                    event.kind === "fail" ? styles.consoleMessageFail : ""
                  }`}
                >
                  {logText(event)}
                </span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
