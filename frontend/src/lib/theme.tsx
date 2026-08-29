"use client";

/**
 * Theme state, held at the root so the choice outlives navigation between
 * runs and the settings screen.
 *
 * The provider does not decide what anything looks like. It owns exactly one
 * fact — `data-theme` on `<html>` — and `globals.css` does the rest. That
 * keeps the whole dark palette in one file where it can be read as a ramp
 * instead of being scattered across components.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  STORAGE_KEY,
  readPreference,
  resolveTheme,
  writePreference,
  type Theme,
  type ThemePreference,
} from "./theme-preference";

const DARK_QUERY = "(prefers-color-scheme: dark)";

interface ThemeContextValue {
  /** What the user chose, including `system`. This is what the settings UI reflects. */
  preference: ThemePreference;
  /** What is actually painted right now, with `system` resolved against the OS. */
  resolved: Theme;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function storage() {
  return typeof window === "undefined" ? null : window.localStorage;
}

function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(DARK_QUERY).matches;
}

/**
 * `system` means "no opinion", so it is expressed by the *absence* of the
 * attribute — that is what lets the `prefers-color-scheme` rule in
 * `globals.css` win, and what keeps a pinned choice overriding it.
 */
function applyPreference(preference: ThemePreference) {
  const root = document.documentElement;
  if (preference === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", preference);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Both start at their server-rendered value and are corrected on mount.
  // Seeding from localStorage here instead would render one thing on the
  // server and another on the client, which is a hydration mismatch. The
  // colours themselves never flash — `themeScript` has already set the
  // attribute before first paint; only this component's idea of the
  // preference arrives a tick late.
  const [preference, setPreferenceState] = useState<ThemePreference>("system");
  const [prefersDark, setPrefersDark] = useState(false);

  useEffect(() => {
    setPreferenceState(readPreference(storage()));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia(DARK_QUERY);
    setPrefersDark(query.matches);
    const onChange = (event: MediaQueryListEvent) => setPrefersDark(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  // Another tab is another window onto the same preference; keep them in step.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      const next = readPreference(storage());
      setPreferenceState(next);
      applyPreference(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    applyPreference(next);
    writePreference(storage(), next);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, resolved: resolveTheme(preference, prefersDark), setPreference }),
    [preference, prefersDark, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside a ThemeProvider");
  return value;
}

/**
 * Runs before first paint, ahead of React, so a pinned theme is on the
 * document by the time anything is drawn. Without it every load flashes the
 * light palette first. Kept to one expression and wrapped in try/catch —
 * storage throws outright in Safari's private mode, and a throw here would
 * block the parser.
 */
export const themeScript = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  STORAGE_KEY,
)});if(t==="dark"||t==="light")document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;
