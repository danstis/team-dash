/**
 * Unit tests for `src/features/tasks/NoResultsState.tsx`.
 *
 * These are the component's own unit tests: they pin the surface in
 * isolation (the heading, the explanation, the composed active-filter
 * list, the clear-all action and the honesty guard) without the filter
 * bar and the task table around it. The end-to-end wiring — a filter
 * combination that matches nothing — is pinned by the integration suite
 * in `tests/integration/tasks/no-results.test.tsx`.
 *
 * The unit suite exists beside the integration suite because the
 * SonarCloud new-code coverage gate reads the `test:unit` and
 * `test:contract` lcov reports only; integration coverage does not
 * count towards it (same reason as the `TaskDetailDrawer` unit suite).
 *
 * Boundary: no network, no IndexedDB, no credentials — the surface is a
 * pure presentation component.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  FilterCriteria,
  ISODate,
  TimezoneSetting,
} from "../../../../src/domain/types";
import { NoResultsState } from "../../../../src/features/tasks/NoResultsState";

const USERS = [
  { gid: "alice", name: "Alice" },
  { gid: "bob", name: "Bo" },
] as const;

const PROJECTS = [
  { gid: "apollo", name: "Apollo" },
  { gid: "borealis", name: "Borealis" },
] as const;

/** Brands a plain date string as the domain's `ISODate`. */
function day(value: string): ISODate {
  return value as ISODate;
}

/** Renders the surface with the given criteria and returns the spy. */
function renderNoResults(criteria: FilterCriteria, timezone?: TimezoneSetting) {
  const onClearAll = vi.fn();
  render(
    <NoResultsState
      criteria={criteria}
      users={USERS}
      projects={PROJECTS}
      onClearAll={onClearAll}
      {...(timezone === undefined ? {} : { timezone })}
    />,
  );
  return onClearAll;
}

describe("NoResultsState", () => {
  afterEach(() => {
    cleanup();
  });

  it("explains what happened and names the next action", () => {
    renderNoResults({ projectGids: ["borealis"] });

    const state = screen.getByTestId("no-results-state");
    expect(state).toHaveAttribute("data-view-state", "no_results");
    const liveRegion = within(state).getByRole("status");
    expect(liveRegion).toHaveAttribute("aria-live", "polite");
    expect(
      within(state).getByRole("heading", { name: /no tasks match/i }),
    ).toBeInTheDocument();

    const explanation = screen.getByTestId("no-results-explanation");
    expect(explanation).toHaveTextContent(/no tasks match/i);
    // FR-085 — the state names the action it offers.
    expect(explanation).toHaveTextContent(/clear all filters/i);
    expect(explanation).not.toHaveTextContent(/date range/i);
    expect(within(liveRegion).queryByRole("button")).not.toBeInTheDocument();
    expect(
      within(liveRegion).queryByTestId("active-filter-chip"),
    ).not.toBeInTheDocument();
  });

  it("lists the active filters that matched nothing", () => {
    renderNoResults({ assigneeGids: ["alice"], projectGids: ["apollo"] });

    const chips = within(screen.getByTestId("no-results-state")).getAllByTestId(
      "active-filter-chip",
    );

    // FR-048 — every applied filter is still listed, by name.
    expect(chips).toHaveLength(2);
    expect(chips[0]).toHaveTextContent(/assignee: alice/i);
    expect(chips[1]).toHaveTextContent(/project: apollo/i);
  });

  it("shows the date range in the given timezone basis", () => {
    renderNoResults(
      {
        dateRange: {
          start: day("2026-03-01"),
          end: day("2026-03-31"),
          preset: "custom",
        },
      },
      "utc",
    );

    expect(
      within(screen.getByTestId("no-results-state")).getByTestId(
        "active-filter-chip",
      ),
    ).toHaveTextContent(/1 mar 2026 – 31 mar 2026/i);
  });

  it("clears every filter through the composed active-filter list", () => {
    const onClearAll = renderNoResults({ projectGids: ["borealis"] });

    fireEvent.click(
      within(screen.getByTestId("no-results-state")).getByTestId(
        "active-filters-clear-all",
      ),
    );

    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when no filter is applied", () => {
    // With nothing applied, an empty list means there is no data at all —
    // the empty-dashboard surface's case, not this one's. Claiming that
    // filters narrowed the list would be a misleading report.
    renderNoResults({});

    expect(screen.queryByTestId("no-results-state")).not.toBeInTheDocument();
  });
});
