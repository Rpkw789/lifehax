"use client";

import { useEffect, useId, useState } from "react";

import { fetchHealth, type Health } from "@/lib/api";
import { useRun } from "@/lib/run-context";
import { useTheme } from "@/lib/theme";
import type { ThemePreference } from "@/lib/theme-preference";
import styles from "../sections.module.css";

/**
 * Settings.
 *
 * Three panels: what this run was configured with, what the backend says it
 * picked up, and the one preference that is actually yours to set. The first
 * two are read-only.
 *
 * There is deliberately no field to paste a key into. Keys live in the
 * backend's environment for the life of a run and must never reach disk, a log
 * line, or an event — a browser form is the wrong place for one, and a fake
 * form that discards what you type is worse than none. What this screen can
 * honestly do is report whether the backend found them.
 */
export default function SettingsScreen() {
  const { input, storeHost, personas, activePersonaCount } = useRun();
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchHealth()
      .then((result) => {
        if (live) setHealth(result);
      })
      .catch((err: unknown) => {
        if (live) {
          setHealthError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      live = false;
    };
  }, []);

  const fields: [string, string][] = [
    ["Store URL", input.storeUrl],
    ["Product feed", input.feedUrl],
    ["Sitemap", input.sitemapUrl],
    ["Agent endpoint", input.agentEndpoint],
    ["Test SKUs", input.testSkus],
  ];

  return (
    <div className={styles.screen}>
      <div className={styles.note}>
        Configuration for run against {storeHost}. Read-only, apart from
        appearance.
      </div>

      <section className={styles.card}>
        <div className={styles.settingLabel}>This run</div>
        {fields.map(([name, value]) => (
          <div key={name} className={styles.field}>
            <span className={styles.fieldName}>{name}</span>
            <span
              className={`${styles.fieldValue} ${value ? "" : styles.fieldEmpty}`}
            >
              {value || "not set"}
            </span>
          </div>
        ))}
        <div className={styles.field}>
          <span className={styles.fieldName}>Population</span>
          <span className={styles.fieldValue}>
            {activePersonaCount} of {personas.length} briefs ·{" "}
            {activePersonaCount * 2} agents
          </span>
        </div>
      </section>

      <section className={styles.card}>
        <div className={styles.settingLabel}>Capabilities</div>

        {healthError ? (
          <div className={styles.capNote}>
            Could not reach the backend — {healthError}
          </div>
        ) : (
          <>
            <Capability
              on={health?.browserbase}
              name="Browser agents"
              onNote="A Browserbase key is configured, so agents really drive a browser."
              offNote="No Browserbase key. Those agents report the key is missing rather than running."
            />
            <Capability
              on={health?.llm}
              name="Model gateway"
              onNote="Briefs are generated from the catalogue and findings are written."
              offNote="Falling back to category-agnostic archetype briefs and rule-based findings."
            />
          </>
        )}

        <div className={styles.caveat}>
          This reports whether the variables are <em>set</em>, not whether they{" "}
          <em>work</em>. Keys are held by the backend for the life of a run and
          are never sent to this page — there is nowhere here to enter one by
          design.
        </div>
      </section>

      <section className={styles.card}>
        <div className={styles.settingLabel}>Appearance</div>
        <Theme />
      </section>
    </div>
  );
}

/**
 * The only setting on this screen that belongs to you rather than to the run,
 * which is why it survives leaving the run. Session captures on Check stay
 * light in every theme — they show the storefront as an agent saw it.
 */
function Theme() {
  const { preference, resolved, setPreference } = useTheme();
  const name = useId();

  const options: [ThemePreference, string][] = [
    ["system", "System"],
    ["light", "Light"],
    ["dark", "Dark"],
  ];

  return (
    <>
      <div className={styles.field}>
        <span className={styles.fieldName}>Theme</span>
        <fieldset className={styles.themeControl}>
          <legend className={styles.themeLegend}>Theme</legend>
          {options.map(([value, label]) => (
            <div key={value} className={styles.themeOption}>
              <input
                className={styles.themeRadio}
                type="radio"
                id={`${name}-${value}`}
                name={name}
                value={value}
                checked={preference === value}
                onChange={() => setPreference(value)}
              />
              <label className={styles.themeLabel} htmlFor={`${name}-${value}`}>
                {label}
              </label>
            </div>
          ))}
        </fieldset>
      </div>

      <div className={styles.field}>
        <span className={styles.fieldName}>Applied</span>
        <span className={styles.fieldValue}>
          {preference === "system"
            ? `following this device — currently ${resolved}`
            : `pinned to ${resolved}`}
        </span>
      </div>
    </>
  );
}

/** One capability line. Undefined means the health check has not answered yet. */
function Capability({
  on,
  name,
  onNote,
  offNote,
}: {
  on: boolean | undefined;
  name: string;
  onNote: string;
  offNote: string;
}) {
  return (
    <div className={styles.capability}>
      <span
        className={styles.capDot}
        style={{
          background:
            on === undefined
              ? "var(--chevron-off)"
              : on
                ? "var(--ink)"
                : "var(--border-strong)",
        }}
      />
      <span className={styles.fieldName}>{name}</span>
      <span className={styles.capNote}>
        {on === undefined ? "checking…" : on ? onNote : offNote}
      </span>
    </div>
  );
}
