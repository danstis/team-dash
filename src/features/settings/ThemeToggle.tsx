/**
 * BSOD-359 — the Settings theme toggle.
 *
 * A three-way control (System / Light / Dark) rendered in the Settings
 * header `actions` slot `SettingsScreen.tsx` built for it. "System"
 * keeps BSOD-356's `prefers-color-scheme` behaviour — the default for a
 * user who has never touched this control.
 *
 * A native radio group (`fieldset` + `legend` + `input[type="radio"]`)
 * rather than a custom widget: it gets labelling, keyboard support
 * (arrow keys move the native radio selection, Tab enters/exits the
 * group once), and checked-state announcement for free, and
 * `global.css` already themes `fieldset`/radio controls and supplies
 * the `:focus-visible` ring every other control in this app uses.
 *
 * State lives in this component, not a context: nothing else in the
 * app reads "which theme is selected" — the CSS reacts to the
 * `data-theme` attribute directly — so there is nothing for a shared
 * provider to broadcast.
 */
import { useCallback, useState, type ReactElement } from "react";

import {
  applyThemePreference,
  readStoredThemePreference,
  storeThemePreference,
  type ThemePreference,
} from "../../app/theme";

const OPTIONS: ReadonlyArray<{
  readonly value: ThemePreference;
  readonly label: string;
}> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function ThemeToggle(): ReactElement {
  const [preference, setPreference] = useState<ThemePreference>(
    readStoredThemePreference,
  );

  const selectPreference = useCallback((next: ThemePreference): void => {
    applyThemePreference(next);
    storeThemePreference(next);
    setPreference(next);
  }, []);

  return (
    <fieldset className="td-theme-toggle" data-testid="theme-toggle">
      <legend>Theme</legend>
      {OPTIONS.map((option) => (
        <label key={option.value}>
          <input
            type="radio"
            name="theme-preference"
            value={option.value}
            checked={preference === option.value}
            onChange={() => selectPreference(option.value)}
          />{" "}
          {option.label}
        </label>
      ))}
    </fieldset>
  );
}
