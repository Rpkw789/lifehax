"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";

import { NAV_ITEMS, activeNavKey, navHref, type NavIcon } from "@/lib/nav";
import { useRun } from "@/lib/run-context";
import styles from "./Sidebar.module.css";

/** All icons are inline SVG at 16px, stroke-width 1.4, fill none, currentColor. */
const ICONS: Record<NavIcon, React.ReactNode> = {
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
};

function Icon({ name }: { name: NavIcon }) {
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

/**
 * The workspace rail.
 *
 * Rows are links, and which one is lit is read off the route segment — the
 * same derivation the Shell uses for the stepper, so the two cannot disagree.
 *
 * Collapsed, it keeps the icons and the toggle: a rail you cannot reopen is
 * worse than one that takes up room.
 */
export function Sidebar({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { runId, storeHost } = useRun();
  const segment = useSelectedLayoutSegment();
  const active = activeNavKey(segment);

  return (
    <div className={`${styles.sidebar} ${collapsed ? styles.collapsed : ""}`}>
      <div className={styles.brand}>
        {!collapsed && (
          <>
            <div className={styles.mark} />
            <div className={styles.wordmark}>Happy2</div>
            <div className={styles.beta}>BETA</div>
          </>
        )}
        <button
          type="button"
          className={styles.toggle}
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            aria-hidden="true"
          >
            <rect x="1.8" y="2.6" width="12.4" height="10.8" rx="2" />
            <path d="M6.2 2.6v10.8" />
          </svg>
        </button>
      </div>

      <nav className={styles.nav}>
        {!collapsed && <div className={styles.sectionLabel}>Workspace</div>}
        {NAV_ITEMS.map((item) => {
          const on = item.key === active;
          return (
            <Link
              key={item.key}
              href={navHref(item.key, runId)}
              className={on ? `${styles.row} ${styles.rowActive}` : styles.row}
              aria-current={on ? "page" : undefined}
              title={collapsed ? item.label : undefined}
            >
              <Icon name={item.icon} />
              {!collapsed && item.label}
            </Link>
          );
        })}
      </nav>

      {!collapsed && (
        <div className={styles.footer}>
          <div className={styles.storeCard}>
            <div className={styles.storeLabel}>Store</div>
            <div className={styles.storeHost}>{storeHost}</div>
          </div>
        </div>
      )}
    </div>
  );
}
