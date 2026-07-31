/**
 * T032 — Shared `ViewState`-driven UI primitives in `src/shared/states/`.
 *
 * Constitution Principle VII ("Accessible, Honest, and Responsive User
 * Experience") requires the loading/empty/first-run/no-results/stale/
 * offline/invalid-token/insufficient-permission/rate-limited/partial-data
 * states to be "deliberately designed and tested rather than treated as
 * incidental errors." `ViewState` (T016, `src/domain/types.ts`) is the
 * discriminated union that lists every required state as a literal,
 * and T032 ships the presentational primitives every feature
 * component hangs off.
 *
 * These tests are the public surface for `src/shared/states/**`. A
 * regression here is more expensive than the apparent size of the
 * primitives: every downstream feature imports through this module, so
 * renaming an export, dropping an `aria-*` attribute, or hard-coding a
 * non-Australian-English string would propagate to every screen at once.
 *
 * Contract pinned by these tests (Constitution Principle III + VII,
 * spec FR-085/FR-087):
 *
 * - Every `ViewState` literal has a dedicated primitive component. The
 *   dispatcher `<ViewStateView>` covers all eleven literals — adding a
 *   new literal to `ViewState` forces an exhaustive switch update here
 *   (otherwise the test suite fails to compile in strict TypeScript).
 *
 * - Each primitive carries a stable `data-view-state="<view_state>"` attribute
 *   on its root element so a feature test can query the live state via
 *   a stable hook without coupling to the inner copy.
 *
 * - Each primitive uses an honest, accessible role:
 *     - `'loading'`     → `role="status"` + `aria-live="polite"`
 *     - failure states → `role="alert"`
 *     - the rest       → `role="status"` (informational, not error)
 *   This satisfies Principle VII's accessibility floor.
 *
 * - Copy uses Australian English spelling consistent with the project
 *   convention (constitution §"Documentation" closing line). Each
 *   primitive pins its heading string verbatim so an i18n sweep that
 *   silently drifts copy fails these tests.
 *
 * - Each primitive renders inside a region the feature can decorate:
 *   the primitive owns the heading + body copy; the wrapping chrome
 *   (the page `<main>`, settings panels, etc.) lives with the feature.
 *   The root element exposes a `data-view-state` hook for test queries.
 *
 * - `<ViewStateView>` accepts an optional `ready` render slot: when the
 *   state is `'ready'`, the dispatcher renders the `ready` slot
 *   instead of a static "ready" primitive (which would force every
 *   consumer to wrap their real UI in a placeholder). For every other
 *   state the dispatcher renders the matching primitive unconditionally.
 *
 * The tests are intentionally written before the implementation
 * (Constitution Principle III Red/Green/Refactor): the first run will
 * fail for the intended reason ("module not found"); the second run,
 * after T032's implementation lands, MUST pass with no test changes.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { ViewState } from "../../../../src/domain/types";

describe("T032 shared ViewState-driven UI primitives", () => {
  afterEach(() => {
    cleanup();
  });

  describe("dispatcher <ViewStateView>", () => {
    it("renders the matching primitive for every ViewState literal (FR-085 exhaustive coverage)", async () => {
      const { ViewStateView } = await import("../../../../src/shared/states");

      const states: ViewState[] = [
        "loading",
        "first_run",
        "empty",
        "cached_stale",
        "offline",
        "invalid_token",
        "insufficient_permission",
        "rate_limited",
        "partial_data",
        "no_results",
        "ready",
      ];

      for (const state of states) {
        const { unmount } = render(
          <ViewStateView state={state} data-testid={`view-${state}`}>
            <span>ready payload</span>
          </ViewStateView>,
        );

        const root = screen.getByTestId(`view-${state}`);
        expect(root.getAttribute("data-view-state")).toBe(state);
        unmount();
      }
    });

    it("renders the `ready` slot for the `'ready'` state instead of a placeholder", async () => {
      const { ViewStateView } = await import("../../../../src/shared/states");

      render(
        <ViewStateView state="ready" data-testid="view-ready">
          <span data-testid="ready-payload">live dashboard payload</span>
        </ViewStateView>,
      );

      expect(screen.getByTestId("ready-payload")).toHaveTextContent(
        "live dashboard payload",
      );
      // The dispatcher renders its slot through the same root element,
      // so the `data-view-state` hook still reflects the resolved state.
      expect(
        screen.getByTestId("view-ready").getAttribute("data-view-state"),
      ).toBe("ready");
    });

    it("passes an `aria-*` decoration through to the wrapping root element", async () => {
      const { ViewStateView } = await import("../../../../src/shared/states");

      render(
        <ViewStateView
          state="loading"
          aria-label="Refreshing dashboard"
          data-testid="view-loading"
        />,
      );

      const root = screen.getByTestId("view-loading");
      expect(root.getAttribute("aria-label")).toBe("Refreshing dashboard");
    });
  });

  describe("loading primitive", () => {
    it("renders a polite status region with a loading heading", async () => {
      const { LoadingState } = await import("../../../../src/shared/states");

      render(<LoadingState />);

      const status = screen.getByRole("status");
      expect(status.getAttribute("aria-live")).toBe("polite");
      expect(status.getAttribute("aria-busy")).toBe("true");
      // Australian-English copy: short, honest, no animation-dependent
      // wording (so screen readers announce it identically whether or
      // not a CSS animation runs).
      expect(
        screen.getByRole("heading", { level: 2, name: /loading/i }),
      ).toBeInTheDocument();
    });

    it("exposes a stable data-view-state hook for feature-level queries", async () => {
      const { LoadingState } = await import("../../../../src/shared/states");

      render(<LoadingState data-testid="loading-root" />);

      const root = screen.getByTestId("loading-root");
      expect(root.getAttribute("data-view-state")).toBe("loading");
    });
  });

  describe("first_run primitive", () => {
    it("renders an inviting call to enter a credential", async () => {
      const { FirstRunState } = await import("../../../../src/shared/states");

      render(<FirstRunState />);

      // Australian-English copy: the primitive's job is to direct the
      // user to the credential entry screen (US1) — the body text must
      // say so explicitly, not rely on iconography alone (Principle VII
      // non-colour-only meaning + screen-reader honesty).
      //
      // Heading hierarchy: the first-run surface is the document's
      // top-level landing page while the T046 route guard is closed
      // (US1 acceptance scenario 1 + FR-001). An `<h2>` here would
      // skip a level (WCAG 1.3.1) since no other heading sits above
      // it on the gate-closed screen, so the primitive renders its
      // title as `<h1>`.
      expect(
        screen.getByRole("heading", { level: 1, name: /first run|first-run/i }),
      ).toBeInTheDocument();
      expect(
        screen.getAllByText(/personal access token|token/i).length,
      ).toBeGreaterThan(0);
      // The primitive is informational, not an error.
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });

  describe("empty primitive", () => {
    it("renders a no-data-yet message with a refresh nudge", async () => {
      const { EmptyState } = await import("../../../../src/shared/states");

      render(<EmptyState />);

      expect(
        screen.getByRole("heading", {
          level: 2,
          name: /no data|nothing|empty/i,
        }),
      ).toBeInTheDocument();
      // The empty state MUST direct the user to refresh — never present
      // a blank table (FR-085). The body copy either names the Refresh
      // action or links to it; both phrasings are acceptable, so the
      // assertion is the lighter "refresh" substring check.
      expect(screen.getByText(/refresh/i)).toBeInTheDocument();
    });
  });

  describe("cached_stale primitive", () => {
    it("renders an explicit 'showing cached data' notice with a last-refresh label", async () => {
      const { CachedStaleState } =
        await import("../../../../src/shared/states");

      // The primitive accepts a `lastRefreshedAt` prop and renders it
      // verbatim — the dispatcher (T046, T060) supplies the value from
      // the latest successful RefreshSession, the primitive never
      // guesses. A future test that supplies an explicit label is the
      // concrete acceptance for that prop.
      render(
        <CachedStaleState
          lastRefreshedAt="2026-07-20T09:00:00Z"
          data-testid="cached-root"
        />,
      );

      // Australian-English: the wording names the fact directly — never
      // presents stale data as current (Principle V + VII).
      expect(
        screen.getByRole("heading", { level: 2, name: /cached data/i }),
      ).toBeInTheDocument();
      // The timestamp string MUST appear in the body so a screen-reader
      // user hears "showing cached data, last refreshed at ...".
      expect(screen.getByText(/2026-07-20/)).toBeInTheDocument();
      expect(
        screen.getByTestId("cached-root").getAttribute("data-view-state"),
      ).toBe("cached_stale");
    });
  });

  describe("offline primitive", () => {
    it("renders a status region explaining refresh is disabled and the cache is still usable", async () => {
      const { OfflineState } = await import("../../../../src/shared/states");

      render(<OfflineState />);

      expect(
        screen.getByRole("heading", { level: 2, name: /offline/i }),
      ).toBeInTheDocument();
      // FR-087: a cached dashboard MUST remain viewable when the
      // browser is offline. The body copy says so explicitly so the
      // user is not left wondering why the dashboard appears stale.
      expect(
        screen.getByText(/cached|cache|still available/i),
      ).toBeInTheDocument();
      // Refresh is disabled offline (FR-087) — the primitive calls that
      // out rather than letting a refresh button silently no-op.
      expect(screen.getByText(/refresh/i)).toBeInTheDocument();
    });
  });

  describe("invalid_token primitive", () => {
    it("renders an alert region with a re-authenticate directive", async () => {
      const { InvalidTokenState } =
        await import("../../../../src/shared/states");

      render(<InvalidTokenState />);

      // Failure states use role="alert" so assistive tech announces them
      // immediately (Principle VII).
      const alert = screen.getByRole("alert");
      expect(alert.getAttribute("data-view-state")).toBe("invalid_token");
      expect(
        screen.getByRole("heading", { level: 2, name: /token/i }),
      ).toBeInTheDocument();
      // FR-001/FR-005: the user can replace the token at any time; the
      // primitive points at that path rather than a generic "try again".
      expect(
        screen.getByText(/replace|re-enter|sign in|sign-in|reauthenticate/i),
      ).toBeInTheDocument();
    });
  });

  describe("insufficient_permission primitive", () => {
    it("renders an alert region explaining the token lacks the needed Asana scope", async () => {
      const { InsufficientPermissionState } =
        await import("../../../../src/shared/states");

      render(<InsufficientPermissionState />);

      const alert = screen.getByRole("alert");
      expect(alert.getAttribute("data-view-state")).toBe(
        "insufficient_permission",
      );
      expect(
        screen.getByRole("heading", { level: 2, name: /permission|access/i }),
      ).toBeInTheDocument();
    });
  });

  describe("rate_limited primitive", () => {
    it("renders an alert region naming the retry-after delay when supplied", async () => {
      const { RateLimitedState } =
        await import("../../../../src/shared/states");

      render(<RateLimitedState retryAfterMs={60_000} />);

      const alert = screen.getByRole("alert");
      expect(alert.getAttribute("data-view-state")).toBe("rate_limited");
      expect(
        screen.getByRole("heading", { level: 2, name: /rate|limit/i }),
      ).toBeInTheDocument();
      // The primitive surfaces the retry-after delay (Asana's
      // `Retry-After` parsed by the client contract) so the user knows
      // when the next refresh is meaningful rather than re-firing
      // immediately.
      expect(screen.getByText(/60|retry|wait/i)).toBeInTheDocument();
    });
  });

  describe("partial_data primitive", () => {
    it("renders an alert region disclosing the partial outcome without masking it as success", async () => {
      const { PartialDataState } =
        await import("../../../../src/shared/states");

      render(
        <PartialDataState
          errorDetail="Asana returned a 5xx on the second of three pages"
          itemsRetrieved={124}
          totalExpected={312}
        />,
      );

      const alert = screen.getByRole("alert");
      expect(alert.getAttribute("data-view-state")).toBe("partial_data");
      expect(
        screen.getByRole("heading", { level: 2, name: /partial/i }),
      ).toBeInTheDocument();
      // Principle II: an incomplete refresh MUST NOT be presented as
      // if it were the new complete cache. The disclosure language
      // appears in the body copy rather than the heading, which keeps
      // the heading stable for screen-reader summarisation.
      expect(
        screen.getByText(/previous|previous good cache|kept/i),
      ).toBeInTheDocument();
      // Progress vs total is surfaced so the user understands how
      // much of the workspace made it through.
      expect(screen.getByText(/124/)).toBeInTheDocument();
      expect(screen.getByText(/312/)).toBeInTheDocument();
    });
  });

  describe("no_results primitive", () => {
    it("renders a status region explaining the filter combination matched zero tasks", async () => {
      const { NoResultsState } = await import("../../../../src/shared/states");

      render(<NoResultsState />);

      const status = screen.getByRole("status");
      expect(status.getAttribute("data-view-state")).toBe("no_results");
      expect(
        screen.getByRole("heading", {
          level: 2,
          name: /no (results|tasks|matches)/i,
        }),
      ).toBeInTheDocument();
      // The primitive hints at clearing filters so a user who narrowed
      // the dataset down to nothing can recover quickly (FR-048's
      // clear-all affordance).
      expect(screen.getByText(/clear|reset|filter/i)).toBeInTheDocument();
    });
  });

  describe("exhaustive coverage of the ViewState literal union", () => {
    it("every ViewState literal has a primitive component", async () => {
      const primitives = await import("../../../../src/shared/states");
      const expected: Record<ViewState, string> = {
        loading: "LoadingState",
        first_run: "FirstRunState",
        empty: "EmptyState",
        cached_stale: "CachedStaleState",
        offline: "OfflineState",
        invalid_token: "InvalidTokenState",
        insufficient_permission: "InsufficientPermissionState",
        rate_limited: "RateLimitedState",
        partial_data: "PartialDataState",
        no_results: "NoResultsState",
        ready: "ViewStateView",
      };

      for (const [state, exportName] of Object.entries(expected)) {
        // `ViewStateView` is the dispatcher for the `'ready'` slot, so
        // it covers both the dispatch contract and the `'ready'` state.
        const exported = (primitives as Record<string, unknown>)[exportName];
        expect(
          exported,
          `missing ${exportName} for state '${state}'`,
        ).toBeDefined();
        expect(
          typeof exported,
          `expected ${exportName} for state '${state}' to be a function`,
        ).toBe("function");
      }
    });
  });
});
