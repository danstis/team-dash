/**
 * BSOD-304 (T050) — Cached-reload UX red→green.
 *
 * Spec / contract references
 * --------------------------
 * Spec FR-021 ("on completion MUST show the outcome … along with the
 * last successful refresh timestamp and whether currently displayed
 * data is cached or fresh") and FR-087 ("the cached dashboard and
 * locally stored snapshot history MUST be viewable while offline, and
 * the system MUST clearly state that refresh is unavailable
 * offline"). The T050 row (tasks.md:124) ships the cached-vs-fresh
 * banner and the offline-disabled Refresh state in
 * `src/features/refresh/FreshnessBanner.tsx`; this integration test
 * pins the red→green contract.
 *
 * What this test pins
 * -------------------
 *
 * 1. On a page that displays cached data, the `<FreshnessBanner />`
 *    component labels the data as cached and surfaces the
 *    `lastRefreshedAt` timestamp verbatim — the user can see at a
 *    glance that the data is not the result of the most recent
 *    refresh (FR-021, FR-090).
 *
 * 2. On a page that displays fresh data (i.e. immediately after a
 *    successful refresh), the same component flips to the "fresh"
 *    variant and surfaces the same timestamp. The two variants are
 *    testable through the `data-freshness` attribute so a future
 *    contributor who re-skins the surface cannot silently drop the
 *    cached-vs-fresh signal.
 *
 * 3. When the browser is offline, the offline-disabled Refresh state
 *    renders a visibly disabled Refresh action and a clear
 *    explanation that refresh is unavailable offline (FR-087). The
 *    explanation is a `data-testid` anchor so a future contributor
 *    cannot remove the text without breaking this contract.
 *
 * 4. When the browser comes back online, the same component flips
 *    back to the enabled state and the offline explanation is
 *    removed — the component is event-driven, not a one-shot
 *    `useState(initialValue)`.
 *
 * Out of scope (other rows, NOT exercised here)
 * ---------------------------------------------
 *
 * - The PWA / service-worker wiring that T053 (BSOD-307) will
 *   configure in `vite.config.ts` via `vite-plugin-pwa`. T053 is
 *   the row that turns the offline branch of this component into a
 *   real cache-served surface; T050 ships the React component the
 *   service-worker-aware dashboard composes around.
 * - The full `RefreshControls` orchestrator that T051 (BSOD-305)
 *   owns. The banner is rendered as a peer of the refresh controls,
 *   not as a replacement, so a future dashboard chrome can mount
 *   the banner above the reporting surface and the controls inside
 *   it independently.
 * - The T049 (BSOD-303) `RefreshButton` is NOT consumed here —
 *   T050 ships its own offline-aware button because the
 *   offline-disabled state is a banner concern, not a controls
 *   concern: a user on a working connection still clicks the
 *   controls' Refresh button; the banner's disabled button is
 *   specifically the offline UX entry point per FR-087.
 *
 * Boundary
 * --------
 * `tests/integration/**` runs against jsdom + `fake-indexeddb` per
 * `tests/setup.ts`. No browser, no live Asana, no live token
 * (NFR-005). `navigator.onLine` is overridden per test to drive the
 * online / offline states; `window` events are fired to validate the
 * event-driven transition.
 */
import { StrictMode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  FreshnessBanner,
  OfflineRefreshState,
} from "../../../src/features/refresh/FreshnessBanner";

/* -------------------------------------------------------------------------- */
/* Test helpers                                                               */
/* -------------------------------------------------------------------------- */

const FIXED_REFRESHED_AT = "2026-07-31T09:42:18.000Z";

/**
 * Override `navigator.onLine` for the duration of a test. jsdom's
 * default is `true`; the helper flips it to the requested value and
 * restores the previous value in the returned teardown so a future
 * contributor who adds an `afterEach(tearDownNavigator)` to a new
 * describe block does not silently leak the override into a later
 * test.
 */
function setNavigatorOnline(value: boolean): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(
    window.navigator,
    "onLine",
  );
  Object.defineProperty(window.navigator, "onLine", {
    value,
    configurable: true,
    writable: true,
  });
  return () => {
    if (descriptor === undefined) {
      delete (window.navigator as { onLine?: boolean }).onLine;
      return;
    }
    Object.defineProperty(window.navigator, "onLine", descriptor);
  };
}

/**
 * Render the cached-reload surface the way the eventual dashboard
 * chrome will compose it: a `<FreshnessBanner />` above the
 * `<OfflineRefreshState />`. Splitting the helper out keeps the
 * per-test bodies focused on the assertions and means a future
 * change to the dashboard chrome's surface (e.g. wrapping it in a
 * `<main>` for the heading hierarchy) is a single-line edit.
 */
function renderCachedReloadSurface(props: {
  readonly lastRefreshedAt: string;
  readonly isCached: boolean;
}): void {
  render(
    <StrictMode>
      <FreshnessBanner
        lastRefreshedAt={props.lastRefreshedAt}
        isCached={props.isCached}
      />
      <OfflineRefreshState onRefresh={() => {}} />
    </StrictMode>,
  );
}

/* -------------------------------------------------------------------------- */
/* FreshnessBanner — cached-vs-fresh labelling                                */
/* -------------------------------------------------------------------------- */

describe("BSOD-304 (T050) — FreshnessBanner cached-reload labelling", () => {
  afterEach(() => {
    cleanup();
  });

  it("labels cached data as cached and surfaces the last-refreshed timestamp", () => {
    renderCachedReloadSurface({
      lastRefreshedAt: FIXED_REFRESHED_AT,
      isCached: true,
    });

    const banner = screen.getByTestId("freshness-banner");
    expect(banner.getAttribute("data-freshness")).toBe("cached");
    expect(banner.getAttribute("data-last-refreshed-at")).toBe(
      FIXED_REFRESHED_AT,
    );
    expect(banner).toHaveTextContent(/last refreshed at/i);
    // The timestamp MUST be rendered verbatim so the user can compare it
    // against a clock without re-parsing an abstract label. The test
    // asserts against the documented `data-last-refreshed-at` attribute
    // as well as the textual rendering for redundancy.
    expect(screen.getByTestId("freshness-last-refreshed-at")).toHaveTextContent(
      FIXED_REFRESHED_AT,
    );
    expect(banner).toHaveTextContent(/this data may not reflect recent/i);
  });

  it("labels fresh data as fresh and surfaces the same timestamp", () => {
    renderCachedReloadSurface({
      lastRefreshedAt: FIXED_REFRESHED_AT,
      isCached: false,
    });

    const banner = screen.getByTestId("freshness-banner");
    expect(banner.getAttribute("data-freshness")).toBe("fresh");
    expect(banner.getAttribute("data-last-refreshed-at")).toBe(
      FIXED_REFRESHED_AT,
    );
    expect(banner).toHaveTextContent(/last refreshed at/i);
    expect(banner).toHaveTextContent(/up to date/i);
    // The cached-state copy MUST NOT leak into the fresh variant — the
    // "may not reflect recent" wording is a stale-data signal, not a
    // generic acknowledgement.
    expect(banner).not.toHaveTextContent(/this data may not reflect recent/i);
  });
});

/* -------------------------------------------------------------------------- */
/* OfflineRefreshState — disabled Refresh with explanation                    */
/* -------------------------------------------------------------------------- */

describe("BSOD-304 (T050) — offline-disabled Refresh state", () => {
  let restoreNavigator: () => void;

  beforeEach(() => {
    restoreNavigator = setNavigatorOnline(true);
  });

  afterEach(() => {
    restoreNavigator();
    cleanup();
  });

  it("renders the refresh action enabled while online and shows no offline explanation", () => {
    render(
      <StrictMode>
        <OfflineRefreshState onRefresh={() => {}} />
      </StrictMode>,
    );

    const state = screen.getByTestId("offline-refresh-state");
    expect(state.getAttribute("data-online")).toBe("true");

    const button = screen.getByTestId("offline-refresh-button");
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute("aria-disabled", "false");
    expect(screen.queryByTestId("offline-explanation")).toBeNull();
  });

  it("disables the refresh action and explains why when the browser is offline", () => {
    restoreNavigator();
    restoreNavigator = setNavigatorOnline(false);

    render(
      <StrictMode>
        <OfflineRefreshState onRefresh={() => {}} />
      </StrictMode>,
    );

    const state = screen.getByTestId("offline-refresh-state");
    expect(state.getAttribute("data-online")).toBe("false");

    const button = screen.getByTestId("offline-refresh-button");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-disabled", "true");

    const explanation = screen.getByTestId("offline-explanation");
    expect(explanation).toHaveTextContent(/refresh is unavailable/i);
    expect(explanation).toHaveTextContent(/offline/i);
    // FR-087 — the cached dashboard remains visible offline; the
    // explanation MUST say so explicitly so the user does not assume
    // the surface is broken.
    expect(explanation).toHaveTextContent(/cached dashboard/i);
  });

  it("re-enables the refresh action when the browser comes back online", () => {
    restoreNavigator();
    restoreNavigator = setNavigatorOnline(false);

    render(
      <StrictMode>
        <OfflineRefreshState onRefresh={() => {}} />
      </StrictMode>,
    );

    expect(screen.getByTestId("offline-refresh-button")).toBeDisabled();
    expect(screen.getByTestId("offline-explanation")).toBeInTheDocument();

    restoreNavigator();
    restoreNavigator = setNavigatorOnline(true);

    act(() => {
      window.dispatchEvent(new Event("online"));
    });

    const button = screen.getByTestId("offline-refresh-button");
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute("aria-disabled", "false");
    expect(screen.queryByTestId("offline-explanation")).toBeNull();
    expect(
      screen.getByTestId("offline-refresh-state").getAttribute("data-online"),
    ).toBe("true");
  });

  it("re-disables the refresh action when the browser goes offline after mount", () => {
    render(
      <StrictMode>
        <OfflineRefreshState onRefresh={() => {}} />
      </StrictMode>,
    );

    expect(screen.getByTestId("offline-refresh-button")).not.toBeDisabled();

    act(() => {
      window.dispatchEvent(new Event("offline"));
    });

    const button = screen.getByTestId("offline-refresh-button");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("offline-explanation")).toHaveTextContent(
      /refresh is unavailable/i,
    );
    expect(
      screen.getByTestId("offline-refresh-state").getAttribute("data-online"),
    ).toBe("false");
  });

  it("does not invoke the click handler while the refresh action is disabled", () => {
    restoreNavigator();
    restoreNavigator = setNavigatorOnline(false);

    let clicked = 0;
    render(
      <StrictMode>
        <OfflineRefreshState
          onRefresh={() => {
            clicked += 1;
          }}
        />
      </StrictMode>,
    );

    const button = screen.getByTestId("offline-refresh-button");
    // The native `disabled` attribute already prevents the click
    // handler from running, but `fireEvent.click` dispatches the
    // synthetic event anyway. The component MUST guard with
    // `aria-disabled` semantics and refuse to call the handler when
    // the surface is offline — a caller that wires `onRefresh` to
    // the network must not fire while offline.
    fireEvent.click(button);
    expect(clicked).toBe(0);
  });
});
