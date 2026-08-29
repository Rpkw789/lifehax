"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/Button";
import { ChevronTrack } from "@/components/ChevronTrack";
import { SectionLabel } from "@/components/SectionLabel";
import { STAGES } from "@/lib/fixtures";
import { useRun } from "@/lib/run-context";
import { elapsedLabel, logText } from "@/lib/simulation";
import { surfaceConsoleState } from "@/lib/surface-events";
import motion from "@/styles/motion.module.css";
import styles from "./check.module.css";
import { LivestreamTile } from "./LivestreamTile";
import { SurfaceColumn } from "./SurfaceColumn";
import { SurfaceConsole } from "./SurfaceConsole";
import tileStyles from "./SurfaceColumn.module.css";
import { UnifiedProgress } from "./UnifiedProgress";
import { buildSurfaces, simulationKeyFor } from "./surfaces";

/** One colour per surface. Browse keeps the ink so tiles stay neutral. */
const SURFACE_COLORS: Record<string, string> = {
  browse: "#101012",
  protocol: "#2563eb",
  guide: "#0b8a5d",
  search: "#7c3aed",
};

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
    sessions,
    tileIds,
    briefs,
    surfaceEvents,
    checkResult,
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
  const hitRate = Math.round((won / Math.max(1, agents.length)) * 100);

  const surfaces = buildSurfaces({
    agents,
    surfaceEvents,
    checkResult,
    complete,
  });

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
          <Button
            variant="outline"
            onClick={() => router.push(`/runs/${runId}/input`)}
          >
            New run
          </Button>
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

      <UnifiedProgress
        surfaces={surfaces}
        colors={SURFACE_COLORS}
        running={running}
      />

      {/* The three probe feeds are text and read fine narrow; the agent tiles
          carry live video and were being squeezed into a quarter of the row. */}
      <div className={styles.feeds}>
        {surfaces
          .filter((surface) => surface.key !== "browse")
          .map((surface) => {
            if (surface.key === "browse") return null;
            const consoleState = surfaceConsoleState(
              simulationKeyFor(surface.key),
              surfaceEvents,
              checkResult,
            );
            return (
              <SurfaceColumn
                key={surface.key}
                surface={surface}
                tick={tick}
                color={SURFACE_COLORS[surface.key]!}
              >
                <SurfaceConsole
                  events={consoleState.events}
                  json={consoleState.json}
                />
              </SurfaceColumn>
            );
          })}
      </div>

      {surfaces
        .filter((surface) => surface.key === "browse")
        .map((surface) => (
          <SurfaceColumn
            key={surface.key}
            surface={surface}
            tick={tick}
            color={SURFACE_COLORS.browse!}
          >
            <div className={tileStyles.tiles}>
              {tiles.map((agent) => (
                <LivestreamTile
                  key={agent.id}
                  agent={agent}
                  storeHost={storeHost}
                  liveViewUrl={sessions[agent.id]}
                  booting={running && agent.progress === 0 && !agent.blocked}
                  brief={briefs[Number(agent.id.replace(/\D/g, "")) - 1]}
                  events={events.filter((e) => e.agentId === agent.id)}
                  href={`/runs/${runId}/agents/${agent.id}`}
                />
              ))}
            </div>
          </SurfaceColumn>
        ))}

      {checkResult && (
        <details className={styles.fullReport}>
          <summary>Full consolidated CheckResult JSON</summary>
          <pre>{JSON.stringify(checkResult, null, 2)}</pre>
        </details>
      )}

      <SectionLabel className={styles.stagesLabel}>
        Journey stages · agents reaching each
      </SectionLabel>
      <div className={styles.stages}>
        {STAGES.map((stage, stageIndex) => {
          const reached = agents.filter((a) => a.progress >= stageIndex + 1).length;
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
                fraction={reached / Math.max(1, agents.length)}
                fill={SURFACE_COLORS.browse!}
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
          <div className={`${styles.boardOutcomeCell} ${styles.boardHeadCell}`}>
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

      {/*
        The old right-hand console lived here. Its content is the browser
        column's own output, so it now renders inside that column's tiles and
        the last few lines are kept below for the whole population.
      */}
      <SectionLabel className={styles.boardLabel}>
        Agent log · {events.length} events
      </SectionLabel>
      <div className={styles.log}>
        {events
          .slice(-8)
          .reverse()
          // Index into the full stream, not the composite: `t` is a 140ms tick,
          // so one agent failing twice inside a window produces two events that
          // are identical on every field the key used.
          .map((event, i) => (
            <div
              key={events.length - 1 - i}
              className={styles.logEntry}
            >
              <span className={styles.logTime}>{elapsedLabel(event.t)}</span>
              <span
                className={styles.logBadge}
                style={{
                  background:
                    agents.find((a) => a.id === event.agentId)?.persona.color ??
                    "var(--border-strong)",
                }}
              >
                {event.agentId}
              </span>
              <span
                className={`${styles.logMessage} ${
                  event.kind === "fail" ? styles.logMessageFail : ""
                }`}
              >
                {logText(event)}
              </span>
            </div>
          ))}
      </div>
    </div>
  );
}
