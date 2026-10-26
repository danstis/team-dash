/**
 * BSOD-310 (T062) — Empty-dashboard first-run state red→green.
 *
 * Spec / contract references
 * --------------------------
 * Spec US2 acceptance scenario 5 (spec.md §"User Story 2"):
 *
 *   "Given the app has never completed a refresh, When the user views
 *    the dashboard, Then they see a clear first-run/empty state directing
 *    them to run a refresh, not a blank or misleading report."
 *
 * And the FR-085 contract that requires it:
 *
 *   "FR-085: The system MUST provide deliberately designed loading,
 *    empty, first-run, no-results, stale-cache, offline,
 *    invalid-token, insufficient-permission, rate-limited, and
 *    partial-data states, each with a clear explanation and, where
 *    applicable, a next action."
 *
 * FR-020 ("the system MUST provide a prominent, explicit manual
 * Refresh action") is what the "next action" of this state resolves
 * to — the empty dashboard is the surface where the very first
 * Refresh happens, so the action must be present, enabled, and
 * labelled.
 *
 * The `ViewState` union in data-model.md lists `'first_run'` and
 * `'empty'` as two distinct cases, so the component renders both and
 * the DOM carries the active case in `data-view-state`.
 *
 * What this test pins
 * -------------------
 *
 * 1. The first-run surface renders with the `first_run` view state, an
 *    explanation that says there is no dashboard data yet, and a
 *    Refresh action the user can press (FR-085 + FR-020).
 *
 * 2. The empty surface renders the same way with the `empty` view
 *    state — a refresh that completed but produced no reportable data
 *    is still "no data exists yet", not "the report is empty".
 *
 * 3. Pressing Refresh invokes the caller's refresh handler exactly
 *    once. The direction the copy gives must be a real, wired action,
 *    not decoration.
 *
 * 4. The surface is DISTINCT from the no-results state (T068,
 *    `src/features/tasks/NoResultsState.tsx`). A no-results state
 *    fires when a filter combination matches zero tasks against data
 *    that already exists, and its next action is "widen the filters";
 *    the empty dashboard fires when no data has been loaded at all and
 *    its next action is "run a refresh". Mixing the two is the
 *    "misleading report" US2 scenario 5 forbids, so the test asserts
 *    the empty dashboard never mentions filters and never publishes the
 *    `no_results` view state.
 *
 * 5. While a refresh is in flight the action is busy and cannot be
 *    fired a second time; a caller-disabled action is likewise inert.
 *
 * 6. The guidance is actionable end to end: pressing Refresh on the
 *    first-run surface runs the real refresh orchestrator against the
 *    MSW fixture, and the workspace's projects and tasks land in the
 *    local cache — i.e. the empty dashboard is not a dead end.
 *
 * Out of scope (other rows, NOT exercised here)
 * ---------------------------------------------
 * - `NoResultsState` (T068 / BSOD-317) — the zero-match filter
 *   surface. This test asserts the empty dashboard does NOT present
 *   that state; it does not exercise the task-table no-results path.
 * - The offline-disabled Refresh surface (T050 / BSOD-304,
 *   `OfflineRefreshState`) — a peer surface owned by that row.
 * - The cached-vs-fresh label (T050, `FreshnessBanner`).
 * - The dashboard chrome that decides *when* the empty dashboard is
 *   shown. This row ships the surface; the chrome that mounts it over
 *   the reporting surface is a later US2 row.
 *
 * Test-first discipline
 * ----------------------
 * Per Constitution Principle III this file lands with the failing
 * test first: the Red phase fails with "Cannot find module
 * '../../../src/features/refresh/EmptyDashboard'", and the same file
 * goes green once `EmptyDashboard` implements the surface below —
 * with no test-side change.
 *
 * Boundary
 * --------
 * `tests/integration/**` runs against jsdom + `fake-indexeddb` + MSW
 * per `tests/setup.ts`. No browser, no live Asana workspace, no real
 * personal access token (Principle III, NFR-005).
 */
import { type ReactElement, StrictMode, useState } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { db } from "../../../src/data/db/schema";
import {
  type RefreshOutcome,
  refreshOrchestrator,
} from "../../../src/data/refresh/refresh-orchestrator";
import { EmptyDashboard } from "../../../src/features/refresh/EmptyDashboard";
import { smallDatasetWorkspaceGid } from "../../../fixtures/asana/small-dataset/data";

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A synthetic, non-secret bearer value. The MSW fixture handlers
 * authorise any `Authorization: Bearer …` request, so the string only
 * has to be shaped like a token — it is not a credential and grants no
 * access anywhere (Principle IV: no real token ever enters a fixture).
 */
const FIXTURE_TOKEN = "fixture-empty-dashboard-token-1234567890";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

async function clearCacheStores(): Promise<void> {
  await db.projects.clear();
  await db.tasks.clear();
  await db.refreshSessions.clear();
}

/**
 * The first-run surface as the dashboard chrome would compose it. The
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
/* The first-run / empty surface                                              */
/* -------------------------------------------------------------------------- */

describe("BSOD-310 (T062) — EmptyDashboard first-run / empty guidance", () => {
  beforeEach(async () => {
    await clearCacheStores();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the first-run state with an explanation and a Refresh action", () => {
    renderEmptyDashboard({ state: "first_run" });

    const dashboard = screen.getByTestId("empty-dashboard");
    expect(dashboard.getAttribute("data-view-state")).toBe("first_run");

    // FR-085 — the state carries a clear explanation. The copy must
    // say that no dashboard data exists yet, so the user does not read
    // a blank report as "you have no work".
    const explanation = screen.getByTestId("empty-dashboard-explanation");
    expect(explanation).toHaveTextContent(/no dashboard data/i);

    // ...and a next action (FR-085): run a refresh.
    expect(explanation).toHaveTextContent(/run a refresh/i);

    // FR-020 — the next action is a real, prominent manual Refresh
    // action rather than prose alone.
    const refreshButton = screen.getByRole("button", { name: "Refresh" });
    expect(refreshButton).toBeEnabled();
    expect(refreshButton).not.toHaveAttribute("aria-busy", "true");
  });

  it("renders the empty state with the same explanation and Refresh action", () => {
    renderEmptyDashboard({ state: "empty" });

    const dashboard = screen.getByTestId("empty-dashboard");
    expect(dashboard.getAttribute("data-view-state")).toBe("empty");

    const explanation = screen.getByTestId("empty-dashboard-explanation");
    expect(explanation).toHaveTextContent(/no dashboard data/i);
    expect(explanation).toHaveTextContent(/run a refresh/i);

    expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled();
  });

  it("invokes the refresh handler once when the user presses Refresh", () => {
    let refreshCount = 0;
    renderEmptyDashboard({
      onRefresh: () => {
        refreshCount += 1;
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    expect(refreshCount).toBe(1);
  });

  it("is distinct from the no-results state — it implies no data exists, not zero filter matches", () => {
    renderEmptyDashboard({ state: "empty" });

    const dashboard = screen.getByTestId("empty-dashboard");

    // The no-results surface (T068) is a filter story: its next action
    // is to widen or clear the filters. This surface must not borrow
    // that framing — there is no data to filter yet.
    expect(dashboard).not.toHaveTextContent(/filters/i);
    expect(dashboard).not.toHaveTextContent(/no tasks matched/i);
    expect(dashboard.getAttribute("data-view-state")).not.toBe("no_results");
    expect(screen.queryByTestId("no-results-state")).toBeNull();
  });

  it("marks the action busy and refuses a second invocation while a refresh is in flight", () => {
    let refreshCount = 0;
    renderEmptyDashboard({
      busy: true,
      onRefresh: () => {
        refreshCount += 1;
      },
    });

    const button = screen.getByRole("button", { name: /refreshing/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");

    fireEvent.click(button);
    expect(refreshCount).toBe(0);
  });

  it("refuses to invoke the refresh handler while the action is disabled", () => {
    let refreshCount = 0;
    renderEmptyDashboard({
      disabled: true,
      onRefresh: () => {
        refreshCount += 1;
      },
    });

    const button = screen.getByRole("button", { name: "Refresh" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(button);
    expect(refreshCount).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* End-to-end: the guidance is actionable                                      */
/* -------------------------------------------------------------------------- */

/**
 * The dashboard chrome's job — mount the first-run surface and wire
 * its Refresh action to the real refresh orchestrator, exactly as the
 * chrome will once the dashboard surface exists.
 */
function FirstRunDashboardHarness(): ReactElement {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<RefreshOutcome | null>(null);

  const runRefresh = async (): Promise<void> => {
    setBusy(true);
    const result = await refreshOrchestrator.runRefresh({
      workspaceGid: smallDatasetWorkspaceGid,
      token: FIXTURE_TOKEN,
    });
    setOutcome(result);
    setBusy(false);
  };

  return (
    <StrictMode>
      <EmptyDashboard
        state="first_run"
        onRefresh={() => {
          void runRefresh();
        }}
        busy={busy}
      />
      <span data-testid="harness-outcome">{outcome?.status ?? "none"}</span>
    </StrictMode>
  );
}

describe("BSOD-310 (T062) — the first-run guidance leads to real data", () => {
  beforeEach(async () => {
    await clearCacheStores();
  });

  afterEach(async () => {
    cleanup();
    await clearCacheStores();
  });

  it("retrieves the workspace data when the user follows the instruction", async () => {
    render(<FirstRunDashboardHarness />);

    // Nothing is cached yet — this is the first-run state.
    expect(await db.projects.count()).toBe(0);
    expect(await db.tasks.count()).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => {
      expect(screen.getByTestId("harness-outcome")).toHaveTextContent(
        "succeeded",
      );
    });

    // The refresh populated the local cache, so the dashboard is no
    // longer empty. The empty dashboard's guidance is therefore not a
    // dead end — following it changes the user's situation.
    expect(await db.projects.count()).toBeGreaterThan(0);
    expect(await db.tasks.count()).toBeGreaterThan(0);
  });
});
