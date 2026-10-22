/**
 * BSOD-360 — the Settings exit policy.
 *
 * User story BSOD-360: "As a user, I want a method in the settings UI
 * to exit back to where I was, so I am not stuck in the settings page
 * after opening it."
 *
 * ## Why the exit is not just `navigate(-1)`
 *
 * The shell router is a **memory** router (`createMemoryRouter` in
 * `src/app/router.tsx`) whose initial entry is `"/"`. A memory
 * router's `go(-1)` clamps the history index to the first entry, so a
 * back navigation from the *initial* entry is a silent no-op: the URL
 * does not change and the Settings screen stays mounted. That is
 * exactly the "stuck in the settings page" case the user story names
 * — the user landed on `/settings` directly (a bookmark, a reload, a
 * future `createBrowserRouter` deep link) and has no earlier entry to
 * pop back to.
 *
 * React Router gives every location a `key`, and the *initial* entry of
 * a history is the one location whose key is the literal `"default"`
 * (see `createMemoryHistory` in react-router: the first initial entry
 * is created with `key: "default"`, every later entry gets a generated
 * key). A location whose key is not `"default"` was therefore reached
 * by pushing (or popping) onto the history, so there IS an earlier
 * entry to return to.
 *
 * The policy is therefore:
 *
 *   - The current location is the router's initial entry
 *     (`location.key === "default"`) → there is nothing to go back to,
 *     so exit navigates to the app shell at `"/"` (the fallback).
 *   - Otherwise → exit navigates one entry back
 *     (`navigate(-1)`), which returns the user to the surface they
 *     came from.
 *
 * ## Why the fallback is the app shell
 *
 * `"/"` is the route the shell mounts the placeholder reporting
 * surface on (and the route the first-run surface is reachable
 * through), so it is the one destination that is meaningful from every
 * state the app can be in — including the gate-closed state, where the
 * route guard renders the first-run surface instead of the outlet.
 *
 * ## Boundary
 *
 * This module is a React hook over React Router's navigation hooks.
 * It owns no rendering, no feature imports, and no business logic; the
 * decision it makes is a pure function of the current location key
 * (`resolveSettingsExitTarget`), which is what the unit test pins.
 */
import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router";

/**
 * The location key React Router assigns to a history's initial entry.
 *
 * Every other location in the same history carries a generated key, so
 * this literal is the discriminator between "the user arrived here
 * directly" and "the user arrived here from somewhere else".
 */
export const INITIAL_LOCATION_KEY = "default";

/**
 * Where the exit sends the user when the router has no earlier entry to
 * return to — the app shell's index route.
 */
export const SETTINGS_EXIT_FALLBACK_PATH = "/";

/**
 * The two ways the Settings exit can be resolved.
 *
 * - `"back"` — pop one entry off the history and return the user to the
 *   surface they came from.
 * - `"fallback"` — navigate to `SETTINGS_EXIT_FALLBACK_PATH` because
 *   the history has no earlier entry.
 */
export type SettingsExitTarget =
  { kind: "back" } | { kind: "fallback"; path: string };

/**
 * Resolve the exit target for a given location key.
 *
 * Pure by design: the unit test pins the decision without mounting a
 * router, and the hook below is a thin adapter over it.
 */
export function resolveSettingsExitTarget(
  locationKey: string,
): SettingsExitTarget {
  if (locationKey === INITIAL_LOCATION_KEY) {
    return { kind: "fallback", path: SETTINGS_EXIT_FALLBACK_PATH };
  }
  return { kind: "back" };
}

/**
 * The Settings exit action.
 *
 * Returns a stable callback that leaves the Settings screen: it pops
 * the history when there is an earlier entry, and falls back to the app
 * shell when there is not.
 */
export function useSettingsExit(): () => void {
  const navigate = useNavigate();
  const location = useLocation();
  const target = resolveSettingsExitTarget(location.key);

  return useCallback((): void => {
    if (target.kind === "back") {
      navigate(-1);
      return;
    }
    navigate(target.path);
  }, [navigate, target]);
}
