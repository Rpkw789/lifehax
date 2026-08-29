"use client";

import { useRun } from "@/lib/run-context";
import styles from "./Sidebar.module.css";

/** All icons are inline SVG at 16px, stroke-width 1.4, fill none, currentColor. */
const ICONS = {
  audit: (
    <>
      <rect x="1.8" y="2.4" width="12.4" height="11.2" rx="2" />
      <path d="M1.8 5.6h12.4M4.4 8.4h4.2M4.4 10.8h6" />
    </>
  ),
  runs: <path d="M2.2 12.6V6.4M6.1 12.6V3.4M10 12.6V8.2M13.8 12.6V5" />,
  personas: (
    <>
      <circle cx="8" cy="8" r="5.4" />
      <path d="M8 2.6v10.8M2.6 8h10.8" />
    </>
  ),
  settings: (
    <>
      <circle cx="8" cy="8" r="2.1" />
      <path d="M8 1.6v1.8M8 12.6v1.8M1.6 8h1.8M12.6 8h1.8M3.6 3.6l1.3 1.3M11.1 11.1l1.3 1.3M12.4 3.6l-1.3 1.3M4.9 11.1l-1.3 1.3" />
    </>
  ),
} as const;

const NAV: { label: string; icon: keyof typeof ICONS; active: boolean }[] = [
  { label: "Readiness audit", icon: "audit", active: true },
  { label: "Past runs", icon: "runs", active: false },
  { label: "Agent personas", icon: "personas", active: false },
  { label: "Settings", icon: "settings", active: false },
];

function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      aria-hidden="true"
      style={{ flex: "none" }}
    >
      {ICONS[name]}
    </svg>
  );
}

export function Sidebar() {
  const { storeHost } = useRun();

  return (
    <div className={styles.sidebar}>
      <div className={styles.brand}>
        <div className={styles.mark} />
        <div className={styles.wordmark}>Happy2</div>
        <div className={styles.beta}>BETA</div>
      </div>

      <nav className={styles.nav}>
        <div className={styles.sectionLabel}>Workspace</div>
        {NAV.map((item) => (
          <button
            key={item.label}
            type="button"
            className={
              item.active ? `${styles.row} ${styles.rowActive}` : styles.row
            }
            aria-current={item.active ? "page" : undefined}
          >
            <Icon name={item.icon} />
            {item.label}
          </button>
        ))}
      </nav>

      <div className={styles.footer}>
        <div className={styles.storeCard}>
          <div className={styles.storeLabel}>Store</div>
          <div className={styles.storeHost}>{storeHost}</div>
        </div>
      </div>
    </div>
  );
}
