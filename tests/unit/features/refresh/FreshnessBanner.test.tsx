/**
 * Unit tests for `src/features/refresh/FreshnessBanner.tsx`.
 *
 * What this file pins
 * -------------------
 * The integration test `tests/integration/refresh/cached-reload.test.tsx`
 * exercises the cached-reload UX end-to-end through the providers
 * (CredentialsProvider / WorkspaceProvider) and a real Dexie /
 * fake-indexeddb round-trip. The two suites do complementary jobs:
 *
 * - Integration: the cross-component contract (the `FreshnessBanner` and
 *   `OfflineRefreshState` surface the right attributes alongside the
 *   real Asana / Dexie / MSW fixtures the rest of the app depends on).
 * - Unit (this file): the leaf-component contract in isolation, with
 *   `navigator.onLine` overridden per test and the `window` online /
 *   offline events fired to drive the state machine. Coverage
 *   instrumentation picks this file up so SonarCloud can verify the
 *   FR-021 / FR-087 surface T050 ships has automated coverage.
 *
 * Scope and boundary
 * ------------------
 * The test imports only the two components the row ships
 * (`FreshnessBanner`, `OfflineRefreshState`) and the React +
 * testing-library surface they need to render. No `CredentialsProvider`,
 * no `WorkspaceProvider`, no MSW, no Dexie. The rendered DOM
 * attributes (`data-freshness`, `data-last-refreshed-at`,
 * `data-online`, `data-testid="offline-explanation"`) are the
 * contract selectors the integration test pins; this file asserts
 * the same attributes so a future contributor who accidentally
 * drops one of them in a refactor fails BOTH suites.
 *
 * Determinism
 * -----------
 * The unit tests are fully deterministic. `navigator.onLine` is
 * overridden per test via `Object.defineProperty(window.navigator,
 * "onLine", …)` and the per-test teardown restores the previous
 * descriptor. The `window` `online` / `offline` events are fired
 * via `act(() => window.dispatchEvent(new Event("online")))` so
 * the React state update settles inside the test's micro-task
 * boundary. No network, no IndexedDB, no MSW.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  FreshnessBanner,
  OfflineRefreshState,
} from "../../../../src/features/refresh/FreshnessBanner";

/* -------------------------------------------------------------------------- */
/* Test helpers                                                               */
/* -------------------------------------------------------------------------- */

const FIXED_REFRESHED_AT = "2026-07-31T09:42:18.000Z";
const SECOND_REFRESHED_AT = "2026-07-31T09:51:02.000Z";

/**
 * Override `navigator.onLine` for the lifetime of a test. The
 * helper returns a teardown that restores the previous descriptor
 * so a future contributor who adds an `afterEach(tearDown)` to a
 * new describe block does not silently leak the override into a
 * later test.
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

/* -------------------------------------------------------------------------- */
/* FreshnessBanner — cached-vs-fresh labelling                                */
/* -------------------------------------------------------------------------- */

describe("FreshnessBanner", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the cached variant with the documented data attributes and copy", () => {
    render(
      <StrictMode>
        <FreshnessBanner lastRefreshedAt={FIXED_REFRESHED_AT} isCached={true} />
      </StrictMode>,
    );

    const banner = screen.getByTestId("freshness-banner");
    expect(banner.tagName).toBe("SECTION");
    expect(banner.getAttribute("data-freshness")).toBe("cached");
    expect(banner.getAttribute("data-last-refreshed-at")).toBe(
      FIXED_REFRESHED_AT,
    );
    expect(banner.getAttribute("role")).toBe("status");
    expect(banner.getAttribute("aria-live")).toBe("polite");
    expect(banner.getAttribute("aria-label")).toBe("Showing cached data");
    expect(banner).toHaveTextContent(/Showing cached data/i);
    expect(banner).toHaveTextContent(/last refreshed at/i);
    expect(banner).toHaveTextContent(FIXED_REFRESHED_AT);
    expect(banner).toHaveTextContent(
      /this data may not reflect recent changes/i,
    );

    // The `data-testid="freshness-last-refreshed-at"` anchor on the
    // <span> wrapping the timestamp is the contract selector the
    // integration test uses to query the verbatim value; a future
    // refactor that moves the timestamp out of the <span> breaks
    // BOTH suites.
    expect(screen.getByTestId("freshness-last-refreshed-at")).toHaveTextContent(
      FIXED_REFRESHED_AT,
    );
  });

  it("renders the fresh variant with the documented data attributes and copy", () => {
    render(
      <StrictMode>
        <FreshnessBanner
          lastRefreshedAt={SECOND_REFRESHED_AT}
          isCached={false}
        />
      </StrictMode>,
    );

    const banner = screen.getByTestId("freshness-banner");
    expect(banner.getAttribute("data-freshness")).toBe("fresh");
    expect(banner.getAttribute("data-last-refreshed-at")).toBe(
      SECOND_REFRESHED_AT,
    );
    expect(banner.getAttribute("aria-label")).toBe("Showing fresh data");
    expect(banner).toHaveTextContent(/Showing fresh data/i);
    expect(banner).toHaveTextContent(/last refreshed at/i);
    expect(banner).toHaveTextContent(SECOND_REFRESHED_AT);
    expect(banner).toHaveTextContent(/up to date/i);

    // The cached-state copy MUST NOT leak into the fresh variant.
    // The "may not reflect recent changes" wording is a stale-data
    // signal, not a generic acknowledgement.
    expect(banner).not.toHaveTextContent(/this data may not reflect recent/i);
  });

  it("renders the heading as <h2> so the surrounding chrome can own the document <h1>", () => {
    // The cached-reload surface is composed INSIDE a larger dashboard
    // chrome that owns the document's <h1>. The component MUST
    // therefore render its title as <h2> — a future contributor who
    // widens it to <h1> would skip a heading level (WCAG 1.3.1)
    // when the chrome also renders an <h1>.
    render(
      <StrictMode>
        <FreshnessBanner lastRefreshedAt={FIXED_REFRESHED_AT} isCached={true} />
      </StrictMode>,
    );
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading).toHaveTextContent("Showing cached data");
  });

  it("surfaces the supplied timestamp verbatim without re-parsing it", () => {
    // The component's contract is "render lastRefreshedAt verbatim" —
    // a future contributor who introduces a `new Date(...)` parse
    // risks dropping timezone info (the spec runs in the user's
    // local timezone by default per FR-029). The verbatim-render
    // invariant is pinned here by passing a non-ISO, non-DST-safe
    // timestamp that would round-trip incorrectly through Date.parse.
    const customTimestamp = "Last refresh: today, 9:42 AM";
    render(
      <StrictMode>
        <FreshnessBanner lastRefreshedAt={customTimestamp} isCached={true} />
      </StrictMode>,
    );
    expect(screen.getByTestId("freshness-last-refreshed-at")).toHaveTextContent(
      customTimestamp,
    );
    expect(
      screen
        .getByTestId("freshness-banner")
        .getAttribute("data-last-refreshed-at"),
    ).toBe(customTimestamp);
  });
});

/* -------------------------------------------------------------------------- */
/* OfflineRefreshState — disabled Refresh with explanation                    */
/* -------------------------------------------------------------------------- */

describe("OfflineRefreshState", () => {
  let restoreNavigator: () => void;

  beforeEach(() => {
    // Default to online for the cases that don't override. The
    // per-case override calls `restoreNavigator()` before changing
    // the value and assigns a new teardown, so the afterEach hook
    // always tears down the most-recent override.
    restoreNavigator = setNavigatorOnline(true);
  });

  afterEach(() => {
    restoreNavigator();
    cleanup();
  });

  it("renders the enabled Refresh action while online with no offline explanation", () => {
    render(
      <StrictMode>
        <OfflineRefreshState onRefresh={() => {}} />
      </StrictMode>,
    );

    const state = screen.getByTestId("offline-refresh-state");
    expect(state.getAttribute("data-online")).toBe("true");
    expect(state.getAttribute("role")).toBe("status");
    expect(state.getAttribute("aria-live")).toBe("polite");

    const button = screen.getByTestId("offline-refresh-button");
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveTextContent("Refresh");
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute("aria-disabled", "false");

    expect(screen.queryByTestId("offline-explanation")).toBeNull();
  });

  it("disables the Refresh action and explains why when the browser is offline at mount", () => {
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
    // FR-087 — the user MUST be told that refresh is unavailable
    // AND that the cached dashboard remains visible, so the
    // explanation is asserted to mention both signals verbatim.
    expect(explanation).toHaveTextContent(/refresh is unavailable/i);
    expect(explanation).toHaveTextContent(/offline/i);
    expect(explanation).toHaveTextContent(/cached dashboard/i);
  });

  it("re-enables the Refresh action when the browser comes back online", () => {
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

  it("re-disables the Refresh action when the browser goes offline after mount", () => {
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

  it("invokes the click handler exactly once when online and clicked", () => {
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
    fireEvent.click(screen.getByTestId("offline-refresh-button"));
    expect(clicked).toBe(1);
  });

  it("does not invoke the click handler while the Refresh action is disabled offline", () => {
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

    // The native `disabled` attribute already prevents the click
    // handler from running, but `fireEvent.click` dispatches the
    // synthetic event anyway. The component MUST guard with
    // `aria-disabled` semantics and refuse to call the handler when
    // the surface is offline — a caller that wires `onRefresh` to
    // the network must not have the click leak through.
    fireEvent.click(screen.getByTestId("offline-refresh-button"));
    expect(clicked).toBe(0);
  });

  it("cleans up the window event listeners on unmount (no leaked subscriptions)", () => {
    const { unmount } = render(
      <StrictMode>
        <OfflineRefreshState onRefresh={() => {}} />
      </StrictMode>,
    );

    // Sanity: initial state is online.
    expect(
      screen.getByTestId("offline-refresh-state").getAttribute("data-online"),
    ).toBe("true");

    unmount();

    // After unmount, dispatching an `offline` event must not throw
    // (a leaked subscription would attempt to call setState on an
    // unmounted component and surface a React warning under dev /
    // StrictMode). The assertion is a no-throw smoke test.
    expect(() => {
      window.dispatchEvent(new Event("offline"));
    }).not.toThrow();

    // Re-render a fresh instance to confirm the cleanup did not
    // leave a stuck subscription in a bad state.
    cleanup();
    render(
      <StrictMode>
        <OfflineRefreshState onRefresh={() => {}} />
      </StrictMode>,
    );
    expect(
      screen.getByTestId("offline-refresh-state").getAttribute("data-online"),
    ).toBe("true");
  });
});
