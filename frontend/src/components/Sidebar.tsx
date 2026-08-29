"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { readLastRunId, writeLastRunId } from "@/lib/last-run";
import { useRunOptional } from "@/lib/run-context";
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

interface NavItem {
  label: string;
  icon: keyof typeof ICONS;
  /** Absent for the screens that do not exist yet; those rows stay inert. */
  href?: string;
  /**
   * Whether this row owns the current URL. A predicate rather than an
   * equality check because the audit row covers all four screens of a run.
   */
  owns?: (pathname: string) => boolean;
}

/**
 * `runId` is what lets the run-scoped rows point somewhere. The settings screen
 * is outside any run, so there it comes from the remembered last run instead of
 * from context. A browser that has never opened a run leaves the run-scoped
 * rows below inert — the same state the unbuilt screens are in — but the audit
 * row always resolves, so the rail is never a dead end.
 */
function navItems(runId: string | null): NavItem[] {
  return [
    {
      label: "Readiness audit",
      icon: "audit",
      // Never inert. With no run to return to this leans on `/`, which
      // redirects into one — the rail must always have at least one way out.
      href: runId ? `/runs/${runId}/input` : "/",
      // The run flow, and an agent's own page — but not the run-scoped
      // sections below, which own their own rows.
      owns: (pathname) =>
        pathname.startsWith("/runs/") &&
        !pathname.endsWith("/personas") &&
        !pathname.endsWith("/history"),
    },
    {
      label: "Past runs",
      icon: "runs",
      href: runId ? `/runs/${runId}/history` : undefined,
      owns: (pathname) => pathname.endsWith("/history"),
    },
    {
      label: "Agent personas",
      icon: "personas",
      href: runId ? `/runs/${runId}/personas` : undefined,
      owns: (pathname) => pathname.endsWith("/personas"),
    },
    {
      label: "Settings",
      icon: "settings",
      href: "/settings",
      owns: (pathname) => pathname === "/settings",
    },
  ];
}

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

/** Remembers the rail across reloads. Cosmetic, so a failure here is ignored. */
const COLLAPSE_KEY = "happy2.sidebar.collapsed";

/** `null` during the server render, and wherever the browser refuses storage. */
function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function Sidebar() {
  // Optional, not required: the settings screen renders the sidebar with no
  // run in scope.
  const run = useRunOptional();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [lastRunId, setLastRunId] = useState<string | null>(null);

  // Read after mount: the server has no idea what this browser last chose, and
  // guessing would flash the wrong width.
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      // Private mode, or site data blocked. The default stands.
    }
    setLastRunId(readLastRunId(storage()));
  }, []);

  // Record the run while we are inside one, so the settings screen — which has
  // no run in scope — still has somewhere to send the user back to.
  const runId = run?.runId ?? null;
  useEffect(() => {
    if (!runId) return;
    writeLastRunId(storage(), runId);
    setLastRunId(runId);
  }, [runId]);

  const toggle = () => {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        // Not worth failing a click over.
      }
      return next;
    });
  };

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
        {/* Survives the collapse: a rail you cannot reopen is worse than one
            that takes up room. */}
        <button
          type="button"
          className={styles.toggle}
          onClick={toggle}
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
        {navItems(runId ?? lastRunId).map((item) => {
          const active = item.owns?.(pathname) ?? false;
          const className = active
            ? `${styles.row} ${styles.rowActive}`
            : styles.row;

          if (!item.href) {
            return (
              <button
                key={item.label}
                type="button"
                className={className}
                aria-current={active ? "page" : undefined}
                title={collapsed ? item.label : undefined}
              >
                <Icon name={item.icon} />
                {!collapsed && item.label}
              </button>
            );
          }

          return (
            <Link
              key={item.label}
              href={item.href}
              className={className}
              aria-current={active ? "page" : undefined}
              title={collapsed ? item.label : undefined}
            >
              <Icon name={item.icon} />
              {!collapsed && item.label}
            </Link>
          );
        })}
      </nav>

      {run && !collapsed && (
        <div className={styles.footer}>
          <div className={styles.storeCard}>
            <div className={styles.storeLabel}>Store</div>
            <div className={styles.storeHost}>{run.storeHost}</div>
          </div>
        </div>
      )}
    </div>
  );
}
