/**
 * Theme preference: the stored choice, and how it resolves against the OS.
 *
 * Deliberately free of React and of `window` — the same three functions are
 * called from the provider, from the pre-paint inline script's TypeScript
 * twin, and from tests, so none of them may assume a browser.
 */

/** What the user chose. `system` defers to the OS rather than pinning a theme. */
export type ThemePreference = "system" | "light" | "dark";

/** What actually gets painted. `system` has been resolved away. */
export type Theme = "light" | "dark";

export const STORAGE_KEY = "happy2-theme";

const PREFERENCES: readonly ThemePreference[] = ["system", "light", "dark"];

/**
 * The subset of `Storage` we touch. Narrow on purpose: it keeps the tests
 * honest and makes the "no storage at all" case a type, not a special case.
 */
export interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && (PREFERENCES as readonly string[]).includes(value);
}

export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): Theme {
  if (preference !== "system") return preference;
  return systemPrefersDark ? "dark" : "light";
}

/**
 * Every read is defensive. Storage throws outright in Safari's private mode,
 * and the stored string is user-writable, so neither its presence nor its
 * contents can be trusted. Anything unexpected means `system`.
 */
export function readPreference(storage: PreferenceStorage | null): ThemePreference {
  if (!storage) return "system";
  try {
    const stored = storage.getItem(STORAGE_KEY);
    return isThemePreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

/** A failed write costs the user their choice on reload. It must not cost them the click. */
export function writePreference(
  storage: PreferenceStorage | null,
  preference: ThemePreference,
): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, preference);
  } catch {
    /* private mode, quota, disabled cookies — the toggle still works this session */
  }
}
