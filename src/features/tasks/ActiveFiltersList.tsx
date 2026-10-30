/**
 * BSOD-315 (T066) — `ActiveFiltersList`, the active-filter surface (US3).
 *
 * Spec / contract references
 * --------------------------
 * - FR-048 (spec.md): "The system MUST let the user combine multiple
 *   filters simultaneously, clear all filters in one action, and see the
 *   currently active filters listed at all times."
 * - Principle VII (constitution): the interface must state the active
 *   filters wherever they affect interpretation — a task list that has
 *   been narrowed without saying so is a misleading report.
 *
 * What this module owns
 * ---------------------
 * The list of the filters currently in force, one entry per active
 * criterion, plus the single "clear all" action FR-048 asks for. The
 * list is ALWAYS rendered: with nothing applied it says so, so the
 * surface is never a silent hole in the layout.
 *
 * What this module deliberately does NOT own
 * ------------------------------------------
 * - The filters themselves. The `FilterCriteria` comes from the caller
 *   (the `FilterBar` produces it); this surface only describes it.
 * - The result of the filters (that is `TaskTable`) and the zero-match
 *   state (that is the no-results surface, T068 / BSOD-317).
 * - The clearing itself. `onClearAll` is a callback: the caller owns the
 *   criteria state, so one source of truth stays in force (DESIGN.md ›
 *   The State Is One Source Rule).
 *
 * Honesty
 * -------
 * The list describes EVERY active criterion. A criterion the surface
 * cannot describe (a dimension the domain contract has not implemented
 * yet) is still surfaced as an entry rather than dropped, because a
 * filter list that quietly omits an applied filter is exactly the
 * dishonest reporting Principle II forbids.
 *
 * Product voice
 * -------------
 * The entries name the filter the way a person would ("Due date",
 * "Assignee", "Unassigned"); the raw `FilterCriteria` literals stay out
 * of the rendered text (DESIGN.md › The Product Voice Rule).
 *
 * Boundary
 * --------
 * `src/features/tasks/**` is the plan-documented home for the task-list
 * React UI. This module imports the domain's `FilterCriteria` type and
 * the domain's `hasActiveFilters` helper, plus the shared date/duration
 * formatters. It performs no I/O and makes no network call.
 */
import type { ReactElement } from "react";

import { hasActiveFilters } from "../../domain/filtering/filters";
import type { FilterCriteria, TimezoneSetting } from "../../domain/types";
import { formatDate } from "../../shared/format";
import type { FilterOption } from "./FilterBar";

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The props `<ActiveFiltersList />` consumes. Every field is `readonly`
 * and consumed via `Readonly<Props>` per the project-wide convention.
 */
export interface ActiveFiltersListProps {
  /** The criteria currently in force. */
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

/**
 * One described active filter: which dimension it belongs to, the label
 * the dimension is known by, and the value the user recognises.
 */
interface ActiveFilterEntry {
  /**
   * The `FilterCriteria` key the entry describes, or `"other"` for a
   * filter the surface cannot describe in detail.
   */
  readonly dimension: keyof FilterCriteria | "other";
  /** The label of the dimension, in plain English. */
  readonly label: string;
  /** The value of the selection, in plain English. */
  readonly value: string;
}

/* -------------------------------------------------------------------------- */
/* Copy                                                                        */
/* -------------------------------------------------------------------------- */

/** The label of the date-range entry. The basis is part of the label. */
const DATE_RANGE_LABEL = "Due date";

/** The label of the assignee entry. */
const ASSIGNEE_LABEL = "Assignee";

/** The label of the project entry. */
const PROJECT_LABEL = "Project";

/** The label of the completion-state entry. */
const COMPLETION_LABEL = "Completion";

/** The value shown for a task with no assignee (FR-047). */
const UNASSIGNED_VALUE = "Unassigned";

/** The label of the criterion the surface cannot describe in detail. */
const UNDESCRIBED_LABEL = "Filter";

/** The value shown for a criterion the surface cannot describe. */
const UNDESCRIBED_VALUE = "Applied";

/* -------------------------------------------------------------------------- */
/* Description helpers                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Resolves a `gid` to a human name, falling back to the raw `gid` when
 * the option is not in the list the caller supplied. Showing the raw id
 * is honest — it names the thing that was filtered on — where inventing
 * a name would not be.
 */
function nameFor(options: readonly FilterOption[], gid: string): string {
  return options.find((option) => option.gid === gid)?.name ?? gid;
}

/**
 * Describes the date-range criterion as "1 Mar 2026 – 31 Mar 2026". A
 * custom range says so, so the user can tell a range they typed from
 * one the app resolved.
 */
function describeDateRange(
  criteria: FilterCriteria,
  timezone: TimezoneSetting,
): ActiveFilterEntry | null {
  const range = criteria.dateRange;
  if (range === undefined) {
    return null;
  }
  const start = formatDate(range.start, timezone);
  const end = formatDate(range.end, timezone);
  const suffix = range.preset === "custom" ? " (custom range)" : "";
  return {
    dimension: "dateRange",
    label: DATE_RANGE_LABEL,
    value: `${start} – ${end}${suffix}`,
  };
}

/**
 * Describes the assignee criterion. The explicit "unassigned" option is
 * named as such; a list of people is named by name.
 */
function describeAssignee(
  criteria: FilterCriteria,
  users: readonly FilterOption[],
): ActiveFilterEntry | null {
  const assigneeGids = criteria.assigneeGids;
  if (assigneeGids === undefined || assigneeGids === null) {
    return null;
  }
  if (assigneeGids === "unassigned") {
    return {
      dimension: "assigneeGids",
      label: ASSIGNEE_LABEL,
      value: UNASSIGNED_VALUE,
    };
  }
  if (assigneeGids.length === 0) {
    return null;
  }
  return {
    dimension: "assigneeGids",
    label: ASSIGNEE_LABEL,
    value: assigneeGids.map((gid) => nameFor(users, gid)).join(", "),
  };
}

/**
 * Describes the project criterion. A task may belong to several
 * projects, so several names can be listed.
 */
function describeProject(
  criteria: FilterCriteria,
  projects: readonly FilterOption[],
): ActiveFilterEntry | null {
  const projectGids = criteria.projectGids;
  if (projectGids === undefined || projectGids === null) {
    return null;
  }
  if (projectGids.length === 0) {
    return null;
  }
  return {
    dimension: "projectGids",
    label: PROJECT_LABEL,
    value: projectGids.map((gid) => nameFor(projects, gid)).join(", "),
  };
}

/**
 * Describes the completion-state criterion.
 */
function describeCompletionState(
  criteria: FilterCriteria,
): ActiveFilterEntry | null {
  const state = criteria.completionState;
  if (state === undefined || state === null) {
    return null;
  }
  return {
    dimension: "completionState",
    label: COMPLETION_LABEL,
    value: state === "complete" ? "Complete" : "Incomplete",
  };
}

/**
 * Builds the list of active filters, in a stable reading order: date
 * range, assignee, project, completion state.
 *
 * When the domain reports an active filter this surface cannot describe
 * — a dimension the filter contract has not implemented yet — a generic
 * entry stands in for it. The filter is still applied, so it must still
 * be visible; hiding it would claim the list shows everything that is
 * in force.
 */
function describeActiveFilters(
  criteria: FilterCriteria,
  users: readonly FilterOption[],
  projects: readonly FilterOption[],
  timezone: TimezoneSetting,
): ActiveFilterEntry[] {
  const entries: (ActiveFilterEntry | null)[] = [
    describeDateRange(criteria, timezone),
    describeAssignee(criteria, users),
    describeProject(criteria, projects),
    describeCompletionState(criteria),
  ];

  const described = entries.filter(
    (entry): entry is ActiveFilterEntry => entry !== null,
  );

  if (hasActiveFilters(criteria) && described.length === 0) {
    described.push({
      dimension: "other",
      label: UNDESCRIBED_LABEL,
      value: UNDESCRIBED_VALUE,
    });
  }

  return described;
}

/* -------------------------------------------------------------------------- */
/* Component                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The list of currently active filters, with the single clear-all
 * action FR-048 requires.
 */
export function ActiveFiltersList({
  criteria,
  users,
  projects,
  onClearAll,
  timezone = "local",
}: Readonly<ActiveFiltersListProps>): ReactElement {
  const entries = describeActiveFilters(criteria, users, projects, timezone);
  const hasFilters = entries.length > 0;

  return (
    <section
      className="td-active-filters"
      data-testid="active-filters-list"
      aria-label="Active filters"
    >
      <h2>Active filters</h2>
      {hasFilters ? (
        <ul
          className="td-active-filters__list"
          data-testid="active-filter-chips"
        >
          {entries.map((entry) => (
            <li
              key={entry.dimension}
              className="td-active-filters__chip"
              data-testid="active-filter-chip"
              data-filter-dimension={entry.dimension}
            >
              {entry.label}: {entry.value}
            </li>
          ))}
        </ul>
      ) : (
        <p
          className="td-active-filters__empty"
          data-testid="active-filters-empty"
        >
          No filters applied.
        </p>
      )}
      <button
        type="button"
        className="td-active-filters__clear-all"
        data-testid="active-filters-clear-all"
        data-variant="danger"
        disabled={!hasFilters}
        aria-disabled={!hasFilters}
        onClick={onClearAll}
      >
        Clear all filters
      </button>
    </section>
  );
}
