/**
 * BSOD-359 — theme preference storage and application.
 *
 * BSOD-356 built the CSS side of light/dark mode (`tokens.css`'s
 * `data-theme` hook) and documented the exact contract a toggle needs:
 * stamp `document.documentElement.dataset.theme = "dark" | "light"`, or
 * delete the attribute to fall back to `prefers-color-scheme`. This
 * module is that contract's one implementation, shared by the early
 * boot-time apply in `main.tsx` (so a returning user's dark preference
 * is on screen before first paint, not flashed in afterwards) and the
 * `ThemeToggle` control.
 *
 * `"system"` is the no-preference state: it removes the `data-theme`
 * attribute so the existing `prefers-color-scheme` media query decides,
 * which is also BSOD-356's documented pre-toggle behaviour — a user who
 * never opens Settings sees no change.
 *
 * `localStorage` (not IndexedDB) because the value is a small
 * synchronous preference, not sensitive data — unlike the credential
 * store, there is no reason to pay IndexedDB's async round-trip just to
 * read it before first paint.
 */
export type ThemePreference = "system" | "light" | "dark";

const STORAGE_KEY = "team-dash:theme-preference";

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

/**
 * Reads the stored preference, defaulting to `"system"` when nothing is
 * stored, the value is unrecognised, or storage is unavailable (private
 * browsing, a disabled storage API) — the same default a first-time
 * user gets.
 */
export function readStoredThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isThemePreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

/** Persists `preference`, or clears the key for `"system"`. */
export function storeThemePreference(preference: ThemePreference): void {
  try {
    if (preference === "system") {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, preference);
    }
  } catch {
    // Storage unavailable — the preference still applies for this
    // page's lifetime via applyThemePreference, it just will not
    // survive a reload.
  }
}

/** Stamps (or clears) `<html data-theme>` per BSOD-356's CSS contract. */
export function applyThemePreference(preference: ThemePreference): void {
  if (preference === "system") {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = preference;
  }
}
