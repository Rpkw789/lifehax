"use client";

import { useId } from "react";

import { SectionLabel } from "@/components/SectionLabel";
import { useTheme } from "@/lib/theme";
import type { ThemePreference } from "@/lib/theme-preference";
import styles from "./settings.module.css";

const OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export default function SettingsPage() {
  const { preference, resolved, setPreference } = useTheme();
  const name = useId();

  return (
    <>
      <div className={styles.header}>
        <div className={styles.title}>Settings</div>
        <div className={styles.meta}>workspace</div>
      </div>

      <div className={styles.body}>
        <section className={styles.section}>
          <SectionLabel className={styles.sectionLabel}>Appearance</SectionLabel>

          <div className={styles.field}>
            <div className={styles.fieldText}>
              <div className={styles.fieldName}>Theme</div>
              <div className={styles.fieldHint}>
                Stored in this browser, so it does not follow you to another
                machine. Session captures on the check screen stay light in
                every theme — they show the storefront as an agent saw it.
              </div>
            </div>

            <fieldset className={styles.control}>
              <legend className={styles.legend}>Theme</legend>
              {OPTIONS.map((option) => (
                <div key={option.value} className={styles.option}>
                  <input
                    className={styles.radio}
                    type="radio"
                    id={`${name}-${option.value}`}
                    name={name}
                    value={option.value}
                    checked={preference === option.value}
                    onChange={() => setPreference(option.value)}
                  />
                  <label
                    className={styles.optionLabel}
                    htmlFor={`${name}-${option.value}`}
                  >
                    {option.label}
                  </label>
                </div>
              ))}
            </fieldset>
          </div>

          <div className={styles.resolved}>
            {preference === "system"
              ? `following this device — currently ${resolved}`
              : `pinned to ${resolved}`}
          </div>
        </section>
      </div>
    </>
  );
}
