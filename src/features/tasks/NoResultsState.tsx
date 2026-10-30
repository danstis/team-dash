/**
 * BSOD-317 (T068) — `NoResultsState`, the zero-match surface of the task
 * list (US3).
 *
 * Spec / contract references
 * --------------------------
 * - FR-085 (spec.md): "The system MUST provide deliberately designed
 *   loading, empty, first-run, no-results, stale-cache, offline,
 *   invalid-token, insufficient-permission, rate-limited, and
 *   partial-data states, each with a clear explanation and, where
 *   applicable, a next action." This is the task list's `'no_results'`
 *   state: it explains that the filters matched nothing and it offers
 *   the way out.
 * - FR-048 (spec.md): the user can combine filters, clear all of them
 *   in one action, and sees the active filters listed at all times. The
 *   state lists them and carries that clear-all action, so a user who
 *   lands on an empty table is not left guessing what to undo.
 * - Principle VII (constitution): an empty table with no explanation is
 *   a misleading report — it reads as "you have no work" when the truth
 *   is "your filters matched nothing".
 *
 * What this module owns
 * ---------------------
 * The surface shown when a filter combination matches none of the tasks
 * the list holds: a heading, an explanation of what happened, the next
 * action (widen the range, or clear the filters), and the active-filter
 * list with its clear-all action.
 *
 * What this module deliberately does NOT own
 * ------------------------------------------
 * - The filters themselves, and the clearing of them. The criteria come
 *   from the caller (the `FilterBar` produces them) and the clear-all
 *   action is `ActiveFiltersList`'s: this surface composes that list
 *   rather than re-implementing a second way to clear filters, so there
 *   is one way to clear them and one place that describes them
 *   (DESIGN.md › The State Is One Source Rule).
 * - The predicate logic. Whether a task survives the criteria is
 *   answered by the T065 contract in `src/domain/filtering/filters.ts`;
 *   this surface only describes the outcome.
 * - The "there is no data at all" state. That is `EmptyDashboard`
 *   (T062 / BSOD-310), which fires when nothing has been cached yet and
 *   its next action is "run a refresh". See the honesty note below.
 *
 * Honesty
 * -------
 * With no filter applied, an empty list means there is no data at all —
 * the empty dashboard's case, not this one's. Pointing the user at
 * filters that were never applied would be exactly the misleading
 * report Principle VII forbids, so this surface renders nothing when no
 * filter is in force and the caller is expected to mount the
 * empty-dashboard surface instead.
 *
 * It is also a peer of the shared `'no_results'` `ViewState` primitive
 * (`src/shared/states/NoResultsState.tsx`, T032): that primitive carries
 * the explanation for a generic view, while this surface adds the
 * task-list's own content — the active-filter list and the clear-all
 * action — so it renders its own markup rather than nesting a second
 * status region inside its own.
 *
 * Product voice
 * -------------
 * The copy names the situation the way a person would ("No tasks match
 * these filters"); no spec id, task id or implementation word appears in
 * the rendered text (DESIGN.md › The Product Voice Rule).
 *
 * Accessibility
 * -------------
 * The surface is a polite status region (`role="status"`,
 * `aria-live="polite"`): a zero-match filter combination is a normal
 * outcome of the user's own choices, not a failure, so it must not be
 * announced as an alert. The heading is an `<h2>` because the surface
 * renders inside the dashboard, whose own `<h1>` owns the top level
 * (WCAG 1.3.1).
 *
 * Boundary
 * --------
 * `src/features/tasks/**` is the plan-documented home for the task-list
 * React UI. This module imports the domain's `hasActiveFilters` helper
 * and the task-list's own `ActiveFiltersList`. It performs no I/O and
 * makes no network call.
 */
import type { ReactElement } from "react";

import { hasActiveFilters } from "../../domain/filtering/filters";
import type { FilterCriteria, TimezoneSetting } from "../../domain/types";
import { ActiveFiltersList } from "./ActiveFiltersList";
import type { FilterOption } from "./FilterBar";

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The props `<NoResultsState />` consumes. Every field is `readonly` and
 * consumed via `Readonly<Props>` per the project-wide convention.
 */
export interface NoResultsStateProps {
  /** The criteria currently in force — the ones that matched nothing. */
  readonly criteria: FilterCriteria;
  /** The people, so an assignee `gid` can be shown by name. */
  readonly users: readonly FilterOption[];
  /** The projects, so a project `gid` can be shown by name. */
  readonly projects: readonly FilterOption[];
  /** Called when the user clears every filter in one action (FR-048). */
  readonly onClearAll: () => void;
  /**
   * The timezone basis the range bounds are evaluated under (FR-029).
   * Defaults to `"local"`, the app-wide default.
   */
  readonly timezone?: TimezoneSetting;
}

/* -------------------------------------------------------------------------- */
/* Copy                                                                        */
/* -------------------------------------------------------------------------- */

/** The heading of the no-results surface. */
const HEADING = "No tasks match these filters";

/**
 * The explanation, and the next action. It names the action the surface
 * actually offers — the "Clear all filters" button of the active-filter
 * list — so the user is not left guessing (FR-085, DESIGN.md › The Next
 * Step Rule).
 */
const EXPLANATION =
  "No tasks match the filters you've applied. Widen the date range, or clear all filters, to see more tasks.";

/* -------------------------------------------------------------------------- */
/* Component                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The task list's zero-match surface: the explanation of what happened,
 * the next action, and the list of the filters that caused it.
 */
export function NoResultsState({
  criteria,
  users,
  projects,
  onClearAll,
  timezone = "local",
}: Readonly<NoResultsStateProps>): ReactElement | null {
  // No filter is in force, so an empty list is not the result of a
  // filter — it means there is no data at all, which is the
  // empty-dashboard surface's case (T062). Saying "no tasks match these
  // filters" when no filter was applied would be a misleading report.
  if (!hasActiveFilters(criteria)) {
    return null;
  }

  return (
    <section
      className="td-no-results"
      data-testid="no-results-state"
      data-view-state="no_results"
      role="status"
      aria-live="polite"
      aria-label="No matching tasks"
    >
      <h2>{HEADING}</h2>
      <p data-testid="no-results-explanation">{EXPLANATION}</p>
      <ActiveFiltersList
        criteria={criteria}
        users={users}
        projects={projects}
        onClearAll={onClearAll}
        timezone={timezone}
      />
    </section>
  );
}
