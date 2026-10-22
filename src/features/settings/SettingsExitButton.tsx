/**
 * BSOD-360 — the Settings exit control.
 *
 * The affordance that lets a user leave the Settings screen: a single
 * button in the Settings header that returns the user to the surface
 * they came from (or to the app shell, when the router has no earlier
 * entry — see `useSettingsExit.ts` for the policy and the memory
 * router's clamping behaviour that makes the fallback necessary).
 *
 * ## Why a button and not a link
 *
 * A `<Link to="/">` would always land on the app shell; it could not
 * honour "exit back to where I was". The exit needs a *history*
 * navigation (`navigate(-1)`) with a fallback, which is an imperative
 * action — a `<button>` is the honest element for it, and it keeps the
 * control out of the keyboard-tab order of the page's links.
 *
 * ## Stable anchors
 *
 * The control carries `data-testid="settings-exit"` (the stable anchor
 * the integration test and any future e2e spec click) and the visible
 * label "Exit settings" (the accessible name a screen reader announces
 * and the text a user reads).
 *
 * ## Boundary
 *
 * This module renders one control and owns no navigation policy of its
 * own — the policy lives in `useSettingsExit.ts` so it can be unit
 * tested without a router.
 */
import { type ReactElement } from "react";

import { useSettingsExit } from "./useSettingsExit";

/**
 * The Settings screen's exit control.
 */
export function SettingsExitButton(): ReactElement {
  const exitSettings = useSettingsExit();

  return (
    <button
      type="button"
      className="td-settings-screen__exit"
      data-testid="settings-exit"
      data-variant="secondary"
      onClick={exitSettings}
    >
      Exit settings
    </button>
  );
}
