"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { MOCK_EVENTS, stopOf } from "@/lib/agent-detail";
import { loadPersonaOverrides, savePersonaOverrides } from "@/lib/api";
import { STAGES } from "@/lib/fixtures";
import { AGENT_IDS, useRun } from "@/lib/run-context";
import { agentStates } from "@/lib/simulation";
import type { AgentState, PersonaOverride } from "@/lib/types";
import { EditableText } from "./EditableText";
import styles from "./personas.module.css";

/**
 * The population, as briefs rather than as sessions.
 *
 * Check shows ten tiles; this shows the five briefs behind them and how each
 * one fared, which is the question "which intents does this store fail" —
 * closer to what the findings are derived from. Every agent links through to
 * its own page.
 */

/**
 * The stop ramp, one token per stage, darkening as the agents get further.
 * Hue would say nothing here — the run has no good and bad stages, only an
 * order — so the segments differ by weight and the legend carries the meaning.
 */
const STOP_TINTS = [
  "--border-strong",
  "--was",
  "--faint",
  "--muted",
  "--blocked",
  "--tertiary",
];

/** "Bargain hunter" → "BH". The avatar is the brief's colour plus its initials. */
function initialsOf(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0] ?? "")
    .join("");
  return letters.toUpperCase() || "AG";
}

/** Where each agent came to rest, in stage order, empty buckets dropped. */
function spreadOf(agents: AgentState[]) {
  const buckets = STAGES.map((stage, index) => ({
    key: stage,
    label: stage,
    count: agents.filter((a) => a.blocked && a.fail === index + 1).length,
    tint: `var(${STOP_TINTS[index]})`,
  }));

  return [
    ...buckets,
    {
      key: "in-flight",
      label: "in flight",
      count: agents.filter((a) => !a.settled).length,
      tint: "var(--chevron-off)",
    },
    {
      key: "reached",
      label: "reached checkout",
      count: agents.filter((a) => a.ok).length,
      tint: "var(--ink)",
    },
  ].filter((bucket) => bucket.count > 0);
}

/** Agents per archetype. Two, everywhere — see `AGENT_IDS`. */
const PER_PERSONA = 2;

/** The edit for one archetype, or undefined if it has never been touched. */
function overrideFor(
  overrides: PersonaOverride[],
  tag: string,
): PersonaOverride | undefined {
  return overrides.find((o) => o.tag === tag);
}

/** One archetype's brief slots with a single seat set or cleared. */
function seatsWith(
  briefs: (string | null)[] | undefined,
  slot: number,
  text: string | null,
): (string | null)[] {
  const seats = Array.from({ length: PER_PERSONA }, (_, i) => briefs?.[i] ?? null);
  seats[slot] = text;
  return seats;
}

/** Overrides with one archetype's entry replaced, empty entries dropped. */
function withOverride(
  overrides: PersonaOverride[],
  tag: string,
  change: (current: PersonaOverride) => PersonaOverride,
): PersonaOverride[] {
  const current = overrideFor(overrides, tag) ?? { tag };
  const next = change(current);
  const empty =
    next.name === undefined && (next.briefs ?? []).every((b) => b == null);
  const rest = overrides.filter((o) => o.tag !== tag);
  return empty ? rest : [...rest, next];
}

export default function PersonasScreen() {
  const { runId, events, agents, personas, briefs, running, input, storeHost } =
    useRun();

  // Edits are filed against the store, so there has to be one. A deep link into
  // a demo run has no store URL yet and stays read-only.
  const editable = input.storeUrl.trim().length > 0;
  const [overrides, setOverrides] = useState<PersonaOverride[]>([]);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!editable) return;
    let live = true;
    loadPersonaOverrides(storeHost)
      .then((loaded) => {
        if (live) setOverrides(loaded);
      })
      .catch(() => {
        // A store with no edits yet is the common case; so is a backend that is
        // not up. Neither is worth an error on a screen that reads fine without.
      });
    return () => {
      live = false;
    };
  }, [editable, storeHost]);

  const edit = useCallback(
    (tag: string, change: (current: PersonaOverride) => PersonaOverride) => {
      setOverrides((current) => {
        const next = withOverride(current, tag, change);
        setSaveState("saving");
        setSaveError(null);
        savePersonaOverrides(storeHost, next)
          .then(() => setSaveState("saved"))
          .catch((err: unknown) => {
            setSaveState("idle");
            setSaveError(err instanceof Error ? err.message : String(err));
          });
        return next;
      });
    },
    [storeHost],
  );

  const mocked = events.length === 0 && !running;
  const shownEvents = mocked ? [...MOCK_EVENTS] : events;
  const shownAgents = mocked
    ? agentStates(shownEvents, personas, AGENT_IDS, true)
    : agents;

  // Two agents per brief, assigned by seat — the same mapping `personaIndexOf`
  // uses, read the other way round.
  const groups = personas.map((persona, index) => ({
    index,
    persona,
    agents: shownAgents.filter((agent) => agent.personaIndex === index),
  }));

  const total = shownAgents.length;
  const won = shownAgents.filter((a) => a.ok).length;
  const spread = spreadOf(shownAgents);

  return (
    <div className={styles.screen}>
      <section className={styles.summary}>
        <div className={styles.figures}>
          <div>
            <div className={styles.value}>{personas.length}</div>
            <div className={styles.label}>briefs</div>
          </div>
          <div>
            <div className={styles.value}>{total}</div>
            <div className={styles.label}>agents</div>
          </div>
          <div>
            <div className={styles.value}>{won}</div>
            <div className={styles.label}>reached checkout</div>
          </div>
        </div>

        <div className={styles.spread}>
          <div className={styles.spreadHead}>
            <span className={styles.spreadTitle}>
              Where the {total} agents stopped
            </span>
            <span className={styles.spreadRate}>
              {total === 0 ? "—" : `${Math.round((won / total) * 100)}% completion`}
            </span>
          </div>
          <div className={styles.track}>
            {spread.map((bucket) => (
              <div
                key={bucket.key}
                style={{
                  width: `${(bucket.count / Math.max(total, 1)) * 100}%`,
                  background: bucket.tint,
                }}
              />
            ))}
          </div>
          <div className={styles.legend}>
            {spread.map((bucket) => (
              <span key={bucket.key} className={styles.legendItem}>
                <i className={styles.legendDot} style={{ background: bucket.tint }} />
                {bucket.label}
                <span className={styles.legendCount}>{bucket.count}</span>
              </span>
            ))}
          </div>
        </div>

        {mocked && <span className={styles.sim}>mock data</span>}

        <p className={styles.notice}>
          {editable
            ? "Click a name or a brief to edit it. Edits are saved against this store and seed its next run — this run's record is unchanged."
            : "Read-only: enter a store URL on the input screen to edit the population."}
          {saveError ? (
            <span className={styles.saveError}> could not save — {saveError}</span>
          ) : saveState === "saving" ? (
            <span className={styles.saveState}> saving…</span>
          ) : saveState === "saved" ? (
            <span className={styles.saveState}> saved for the next run</span>
          ) : null}
        </p>
      </section>

      <div className={styles.list}>
        {groups.map((group) => {
          const reached = group.agents.filter((a) => a.ok).length;
          const edits = overrideFor(overrides, group.persona.tag);
          return (
            <section key={group.persona.tag} className={styles.persona}>
              <header className={styles.personaHead}>
                <span
                  className={styles.avatar}
                  style={{ background: group.persona.color }}
                >
                  {initialsOf(group.persona.name)}
                </span>
                <div className={styles.identity}>
                  <div className={styles.titleRow}>
                    <h2 className={styles.name}>
                      <EditableText
                        label={`Name for ${group.persona.tag}`}
                        value={edits?.name ?? group.persona.name}
                        edited={edits?.name !== undefined}
                        disabled={!editable}
                        onCommit={(next) =>
                          edit(group.persona.tag, (o) => ({ ...o, name: next }))
                        }
                        onRevert={() =>
                          edit(group.persona.tag, ({ name: _drop, ...rest }) => rest)
                        }
                      />
                    </h2>
                    <span className={styles.tag}>{group.persona.tag}</span>
                  </div>
                  {/* The archetype's own intent, shown only once the agents
                      have briefs of their own — before that it is the
                      placeholder their quotes already fall back to, and the
                      card would say the same sentence three times. */}
                  {briefs.length > 0 && (
                    <div className={styles.brief}>{group.persona.prompt}</div>
                  )}
                </div>
                <span className={styles.progress}>
                  {reached}/{group.agents.length} reached checkout
                </span>
                <span
                  className={`${styles.pill} ${
                    reached === 0 ? styles.pillFail : styles.pillOk
                  }`}
                >
                  {reached === 0
                    ? "all blocked"
                    : reached === group.agents.length
                      ? "clear"
                      : "partial"}
                </span>
              </header>

              <div className={styles.agents}>
                {group.agents.map((agent) => {
                  const seat = Number(agent.id.replace(/\D/g, "")) || 1;
                  // Which of the archetype's two seats this agent sits in, which
                  // is how an edit addresses it.
                  const slot = (seat - 1) % PER_PERSONA;
                  const written = briefs[seat - 1] ?? group.persona.prompt;
                  const brief = edits?.briefs?.[slot] ?? written;
                  const stop = stopOf(agent);
                  return (
                    <div key={agent.id} className={styles.agent}>
                      <div className={styles.agentHead}>
                        <Link
                          className={styles.agentId}
                          href={`/runs/${runId}/agents/${agent.id}`}
                        >
                          {agent.id} ↗
                        </Link>
                        <span
                          className={`${styles.pill} ${
                            stop.tone === "fail"
                              ? styles.pillFail
                              : stop.tone === "ok"
                                ? styles.pillOk
                                : ""
                          }`}
                        >
                          {stop.label}
                        </span>
                      </div>

                      <p className={styles.quote}>
                        <EditableText
                          multiline
                          className={styles.quoteText}
                          label={`Brief for ${agent.id}`}
                          value={brief}
                          edited={edits?.briefs?.[slot] != null}
                          disabled={!editable}
                          onCommit={(next) =>
                            edit(group.persona.tag, (o) => ({
                              ...o,
                              briefs: seatsWith(o.briefs, slot, next),
                            }))
                          }
                          onRevert={() =>
                            edit(group.persona.tag, (o) => ({
                              ...o,
                              briefs: seatsWith(o.briefs, slot, null),
                            }))
                          }
                        />
                      </p>

                      <div className={styles.rail}>
                        {STAGES.map((stage, index) => {
                          const cleared = agent.progress >= index + 1;
                          const blocked = agent.blocked && agent.fail === index + 1;
                          return (
                            <span key={stage} className={styles.stage}>
                              <span className={styles.stageMark}>
                                <span
                                  className={`${styles.dot} ${
                                    blocked
                                      ? styles.dotBlocked
                                      : cleared
                                        ? styles.dotCleared
                                        : ""
                                  }`}
                                />
                                <span
                                  className={`${styles.stageName} ${
                                    blocked
                                      ? styles.stageNameBlocked
                                      : cleared
                                        ? styles.stageNameCleared
                                        : ""
                                  }`}
                                >
                                  {stage}
                                </span>
                              </span>
                              <span
                                className={`${styles.line} ${
                                  cleared ? styles.lineCleared : ""
                                }`}
                              />
                            </span>
                          );
                        })}
                      </div>

                      <div className={styles.reason}>{stop.detail}</div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
