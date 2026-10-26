/**
 * Unit tests for `src/features/refresh/EmptyDashboard.tsx`.
 *
 * What this file pins
 * -------------------
 * The integration test `tests/integration/refresh/empty-dashboard.test.tsx`
 * exercises the empty-dashboard UX end-to-end — it wires the surface's
 * Refresh action to the real refresh orchestrator and asserts that
 * following the instruction populates the local cache. The two suites
 * do complementary jobs:
 *
 * - Integration: the cross-component contract — the surface's guidance
 *   is actionable against the real orchestrator, the real MSW fixtures
 *   and the real Dexie cache.
 * - Unit (this file): the leaf-component contract in isolation. The
 *   DOM attributes (`data-view-state`, `data-testid`, `role`,
 *   `aria-live`, `aria-label`, `aria-busy`, `aria-disabled`), the
 *   heading level, the copy, and the click / busy / disabled
 *   behaviour, with no providers, no MSW, no Dexie. Coverage
 *   instrumentation picks this file up so SonarCloud can verify the
 *   FR-085 / FR-020 surface T062 ships has automated coverage (the
 *   integration job's coverage is not uploaded to the scanner).
 *
 * Scope and boundary
 * ------------------
 * The test imports only the component the row ships (`EmptyDashboard`)
 * and the React + testing-library surface it needs to render. No
 * `CredentialsProvider`, no `WorkspaceProvider`, no MSW, no Dexie. The
 * rendered DOM attributes are the contract selectors the integration
 * test pins; this file asserts the same attributes so a future
 * contributor who accidentally drops one of them in a refactor fails
 * BOTH suites.
 *
 * Determinism
 * -----------
 * The unit tests are fully deterministic: the component is synchronous
 * on first paint (no async init, no IndexedDB read, no network), so
 * every assertion is a plain render-and-assert. No network, no
 * IndexedDB, no MSW.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { EmptyDashboard } from "../../../../src/features/refresh/EmptyDashboard";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Render the surface the way the dashboard chrome composes it. The
 * helper keeps the per-test bodies focused on the assertions.
 */
function renderEmptyDashboard(props: {
  readonly state?: "first_run" | "empty";
  readonly onRefresh?: () => void;
  readonly disabled?: boolean;
  readonly busy?: boolean;
}): void {
  render(
    <StrictMode>
      <EmptyDashboard
        state={props.state ?? "first_run"}
        onRefresh={props.onRefresh ?? (() => {})}
        disabled={props.disabled ?? false}
        busy={props.busy ?? false}
      />
    </StrictMode>,
  );
}

/* -------------------------------------------------------------------------- */
/* The surface                                                                */
/* -------------------------------------------------------------------------- */

describe("EmptyDashboard", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the first-run variant with the documented DOM contract and copy", () => {
    renderEmptyDashboard({ state: "first_run" });

    const dashboard = screen.getByTestId("empty-dashboard");
    expect(dashboard.tagName).toBe("SECTION");
    expect(dashboard.getAttribute("data-view-state")).toBe("first_run");
    expect(dashboard.getAttribute("role")).toBe("status");
    expect(dashboard.getAttribute("aria-live")).toBe("polite");
    expect(dashboard.getAttribute("aria-label")).toBe("Dashboard empty");

    // FR-085 — a clear explanation that no data exists yet, plus the
    // next action. The copy must never read as "you have no work".
    const explanation = screen.getByTestId("empty-dashboard-explanation");
    expect(explanation).toHaveTextContent(/no dashboard data/i);
    expect(explanation).toHaveTextContent(/run a refresh/i);

    // FR-020 — the next action is a real, labelled control.
    const button = screen.getByTestId("empty-dashboard-refresh-button");
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveTextContent("Refresh");
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute("aria-disabled", "false");
    expect(button).toHaveAttribute("aria-busy", "false");
  });

  it("renders the empty variant with the same explanation and Refresh action", () => {
    renderEmptyDashboard({ state: "empty" });

    const dashboard = screen.getByTestId("empty-dashboard");
    expect(dashboard.getAttribute("data-view-state")).toBe("empty");

    const explanation = screen.getByTestId("empty-dashboard-explanation");
    expect(explanation).toHaveTextContent(/no dashboard data/i);
    expect(explanation).toHaveTextContent(/run a refresh/i);

    expect(
      screen.getByTestId("empty-dashboard-refresh-button"),
    ).toHaveTextContent("Refresh");
  });

  it("renders the heading as <h2> so the surrounding chrome can own the document <h1>", () => {
    // The empty dashboard is composed INSIDE the dashboard chrome that
    // owns the document's <h1>. The component MUST therefore render
    // its title as <h2> — a future contributor who widens it to <h1>
    // would skip a heading level (WCAG 1.3.1).
    renderEmptyDashboard({ state: "empty" });
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      /no dashboard data yet/i,
    );
  });

  it("never borrows the no-results framing", () => {
    // The no-results surface (T068) points at filters; this surface
    // must not, because no filter has been applied — there is no data
    // to filter yet.
    renderEmptyDashboard({ state: "empty" });

    const dashboard = screen.getByTestId("empty-dashboard");
    expect(dashboard).not.toHaveTextContent(/filters/i);
    expect(dashboard).not.toHaveTextContent(/no tasks matched/i);
    expect(dashboard.getAttribute("data-view-state")).not.toBe("no_results");
  });

  it("invokes the refresh handler exactly once when the action is clicked", () => {
    let clicked = 0;
    renderEmptyDashboard({
      onRefresh: () => {
        clicked += 1;
      },
    });

    fireEvent.click(screen.getByTestId("empty-dashboard-refresh-button"));
    expect(clicked).toBe(1);
  });

  it("marks the action busy and refuses to fire it while a refresh is in flight", () => {
    let clicked = 0;
    renderEmptyDashboard({
      busy: true,
      onRefresh: () => {
        clicked += 1;
      },
    });

    const button = screen.getByTestId("empty-dashboard-refresh-button");
    expect(button).toHaveTextContent("Refreshing…");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAttribute("aria-busy", "true");

    fireEvent.click(button);
    expect(clicked).toBe(0);
  });

  it("refuses to fire the action while the caller has disabled it", () => {
    let clicked = 0;
    renderEmptyDashboard({
      disabled: true,
      onRefresh: () => {
        clicked += 1;
      },
    });

    const button = screen.getByTestId("empty-dashboard-refresh-button");
    expect(button).toHaveTextContent("Refresh");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAttribute("aria-busy", "false");

    fireEvent.click(button);
    expect(clicked).toBe(0);
  });
});
