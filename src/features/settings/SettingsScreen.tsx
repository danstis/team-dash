/**
 * BSOD-360 — the Settings screen chrome.
 *
 * The Settings surface is a *screen*, not a single panel: it owns a
 * header (the title plus the controls a user needs to act on the
 * screen as a whole) and a body (the settings sections themselves).
 * BSOD-360 adds the exit control to that header so a user is never
 * stranded on the Settings screen after opening it.
 *
 * ## Why the sections are children
 *
 * The screen renders whatever sections it is given as `children`; the
 * router decides which sections exist. That keeps this module free of
 * feature imports (it knows nothing about credentials, and after
 * BSOD-359 lands it will still know nothing about them) and gives the
 * next settings section — the light/dark theme toggle — a slot that
 * needs no change to this file:
 *
 * ```tsx
 * <SettingsScreen actions={<ThemeToggle />}>
 *   <SettingsCredentialsPanel />
 * </SettingsScreen>
 * ```
 *
 * The `actions` slot is the same idea for the header: it renders extra
 * controls beside the exit control. BSOD-359 can pass its theme toggle
 * through it without touching the exit control or the header layout.
 *
 * ## Why the screen owns a `<main>` landmark
 *
 * The placeholder reporting surface (`src/app/router.tsx`) is a
 * `<main lang="en-AU">` and the first-run surface is a `<main>` too,
 * so the Settings screen follows the same convention: one `main`
 * landmark per rendered screen, and the same `lang` attribute.
 *
 * ## Boundary
 *
 * This module lives under `src/features/settings/**`. It imports the
 * exit control from the same folder and React Router's navigation
 * hooks (through `useSettingsExit`). It imports no credential feature
 * and no data layer — the sections arrive as children.
 */
import { type ReactElement, type ReactNode } from "react";

import { SettingsExitButton } from "./SettingsExitButton";

export interface SettingsScreenProps {
  /**
   * The settings sections rendered under the header. The router owns
   * which sections exist; the screen only owns their layout.
   */
  readonly children: ReactNode;
  /**
   * Extra header controls rendered beside the exit control (e.g. the
   * BSOD-359 theme toggle). The exit control always renders last so it
   * stays the terminal action in the header.
   */
  readonly actions?: ReactNode;
}

/**
 * The Settings screen: a header (title + controls) above the settings
 * sections.
 */
export function SettingsScreen({
  children,
  actions,
}: SettingsScreenProps): ReactElement {
  return (
    <main
      className="team-dash-shell td-settings-screen"
      lang="en-AU"
      data-testid="settings-screen"
    >
      <header className="td-settings-screen__header">
        <h1 className="td-settings-screen__title">Settings</h1>
        <div className="td-settings-screen__actions">
          {actions}
          <SettingsExitButton />
        </div>
      </header>
      <div className="td-settings-screen__sections">{children}</div>
    </main>
  );
}
