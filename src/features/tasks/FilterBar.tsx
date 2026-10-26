/**
 * BSOD-315 (T066) — `FilterBar`, the task-list filter surface (US3).
 *
 * Spec / contract references
 * --------------------------
 * - FR-032 (spec.md): "The system MUST offer date-range presets including
 *   at least this week, last week, last 30 days, this month, last month,
 *   and this quarter, plus a custom start/end range."
 * - FR-047 (spec.md): the system MUST support composable filtering by date
 *   range, assignee (including an explicit "unassigned" option), project
 *   and completion state.
 * - FR-048 (spec.md): multiple filters combine simultaneously.
 * - FR-033 (spec.md): the date basis must be explicit — this surface
 *   states that the range is matched on the due date.
 *
 * What this module owns
 * ---------------------
 * The controls that produce a `FilterCriteria`: the date-range preset
 * selector (with a custom start/end pair), the assignee checkboxes
 * (including the explicit "Unassigned" option), the project checkboxes,
 * and the completion-state selector. The component is CONTROLLED: it
 * renders the criteria it is given and reports every change through
 * `onChange` with a complete, new `FilterCriteria` object.
 *
 * What this module deliberately does NOT own
 * ------------------------------------------
 * - The predicate logic. Every "does this task match?" question is
 *   answered by the T065 contract in `src/domain/filtering/filters.ts`;
 *   this surface only *describes* the selection. Re-implementing the
 *   predicates here would let the filter bar and the domain drift apart.
 * - The display of the active filters (that is `ActiveFiltersList`) and
 *   the rendering of the result (that is `TaskTable`).
 * - The date-range *resolution* of a preset. The preset vocabulary and
 *   its calendar boundaries live in the domain (`DATE_RANGE_PRESETS` in
 *   `src/domain/types.ts` and `resolveDateRangePreset` in
 *   `src/domain/datetime`), so the bar cannot disagree with the rest of
 *   the app about what "this week" means.
 *
 * Clock injection
 * ---------------
 * The presets are resolved against an injected `now`, never against the
 * wall clock, so the surface is reproducible from its inputs (the same
 * discipline `MetricContext.now` follows). The caller decides what "now"
 * means — the dashboard passes the same instant the metrics use.
 *
 * Product voice
 * -------------
 * The rendered copy names the filters the way a person would ("This
 * week", "Unassigned", "Incomplete"); the raw `FilterCriteria` literals
 * stay in the values, never in the text (DESIGN.md › Interaction & Copy
 * › The Product Voice Rule).
 *
 * Boundary
 * --------
 * `src/features/tasks/**` is the plan-documented home for the task-list
 * React UI. This module imports the domain's date vocabulary and the
 * domain's `FilterCriteria` type — it performs no I/O, touches no
 * database, and makes no network call.
 */
import type { ReactElement } from "react";

import { resolveDateRangePreset, toIsoDate } from "../../domain/datetime";
import {
  DATE_RANGE_PRESETS,
  type DateRangePreset,
  type FilterCriteria,
  type ISODate,
  type TimezoneSetting,
} from "../../domain/types";

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A selectable option the filter bar offers — a person or a project.
 *
 * The surface needs a `gid` to put in the criteria and a `name` to show
 * the user; it deliberately does not need anything else about the person
 * or project, so this shape stays small enough for the caller to build
 * straight from the cache.
 */
export interface FilterOption {
  /** The Asana `gid` of the person or project. */
  readonly gid: string;
  /** The human name shown in the control and in the active-filter list. */
  readonly name: string;
}

/**
 * The props `<FilterBar />` consumes. Every field is `readonly` and
 * consumed via `Readonly<Props>` per the project-wide convention.
 */
export interface FilterBarProps {
  /**
   * The criteria currently in force. The bar renders exactly this
   * selection, so the caller always owns the single source of truth
   * (DESIGN.md › The State Is One Source Rule).
   */
  readonly criteria: FilterCriteria;
  /**
   * Called with the complete next criteria whenever the user changes a
   * filter. The bar never mutates `criteria` — it hands over a new
   * object so the caller's state update is a plain replacement.
   */
  readonly onChange: (criteria: FilterCriteria) => void;
  /** The people the assignee filter offers. */
  readonly users: readonly FilterOption[];
  /** The projects the project filter offers. */
  readonly projects: readonly FilterOption[];
  /**
   * The instant the date-range presets are resolved against. Injected
   * rather than read from the wall clock so the surface is
   * reproducible (Principle VI).
   */
  readonly now: Date;
  /**
   * The timezone basis the range bounds are evaluated under (FR-029).
   * Defaults to `"local"`, the app-wide default.
   */
  readonly timezone?: TimezoneSetting;
}

/* -------------------------------------------------------------------------- */
/* Copy                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The label shown for each date-range preset. The literal stays a raw
 * enum in the option VALUE; the label is the plain-English phrase the
 * user reads (The Product Voice Rule).
 */
const PRESET_LABELS: Readonly<Record<DateRangePreset, string>> = {
  this_week: "This week",
  last_week: "Last week",
  last_30_days: "Last 30 days",
  this_month: "This month",
  last_month: "Last month",
  this_quarter: "This quarter",
};

/** The label of the option that clears the date-range filter. */
const ANY_TIME_LABEL = "Any time";

/** The label of the custom start/end range option. */
const CUSTOM_RANGE_LABEL = "Custom range";

/** The label of the completion-state option that clears that filter. */
const ALL_TASKS_LABEL = "All tasks";

/* -------------------------------------------------------------------------- */
/* Component                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The task-list filter bar.
 *
 * Every control reports a complete `FilterCriteria` through `onChange`;
 * the bar holds no filter state of its own. That keeps the bar, the
 * active-filter list and the task table reading the same object, which
 * is what makes FR-048's "the currently active filters are listed at all
 * times" true by construction rather than by convention.
 */
export function FilterBar({
  criteria,
  onChange,
  users,
  projects,
  now,
  timezone = "local",
}: Readonly<FilterBarProps>): ReactElement {
  const dateRange = criteria.dateRange;
  const selectedAssigneeGids = Array.isArray(criteria.assigneeGids)
    ? criteria.assigneeGids
    : [];
  const unassignedSelected = criteria.assigneeGids === "unassigned";
  const selectedProjectGids = criteria.projectGids ?? [];

  /* ------------------------------------------------------------------ */
  /* Date range                                                          */
  /* ------------------------------------------------------------------ */

  const handleDateRangePresetChange = (value: string): void => {
    if (value === "") {
      onChange({ ...criteria, dateRange: undefined });
      return;
    }

    if (value === "custom") {
      // Keep the user's own bounds when they are already custom; start
      // a fresh single-day range at the anchor otherwise, so the custom
      // inputs always hold a valid, editable pair.
      const anchor = toIsoDate(now, timezone);
      const start = dateRange?.preset === "custom" ? dateRange.start : anchor;
      const end = dateRange?.preset === "custom" ? dateRange.end : anchor;
      onChange({ ...criteria, dateRange: { start, end, preset: "custom" } });
      return;
    }

    const preset = DATE_RANGE_PRESETS.find((candidate) => candidate === value);
    if (preset === undefined) {
      // An unknown value cannot name a range; ignoring it keeps the
      // criteria untouched rather than storing a preset the domain
      // cannot resolve.
      return;
    }

    const bounds = resolveDateRangePreset(preset, now, timezone);
    onChange({
      ...criteria,
      dateRange: { start: bounds.start, end: bounds.end, preset },
    });
  };

  const handleCustomStartChange = (value: string): void => {
    if (value === "") {
      return;
    }
    const start = value as ISODate;
    const end =
      dateRange !== undefined && dateRange.end < start
        ? start
        : (dateRange?.end ?? start);
    onChange({ ...criteria, dateRange: { start, end, preset: "custom" } });
  };

  const handleCustomEndChange = (value: string): void => {
    if (value === "") {
      return;
    }
    const end = value as ISODate;
    const start =
      dateRange !== undefined && dateRange.start > end
        ? end
        : (dateRange?.start ?? end);
    onChange({ ...criteria, dateRange: { start, end, preset: "custom" } });
  };

  /* ------------------------------------------------------------------ */
  /* Assignee                                                            */
  /* ------------------------------------------------------------------ */

  const handleAssigneeToggle = (gid: string, selected: boolean): void => {
    if (selected) {
      // Selecting a person clears the explicit "unassigned" option: the
      // domain contract models the two as alternatives, so the bar must
      // not offer a combination the contract cannot express.
      onChange({ ...criteria, assigneeGids: [...selectedAssigneeGids, gid] });
      return;
    }
    const remaining = selectedAssigneeGids.filter(
      (existing) => existing !== gid,
    );
    onChange({
      ...criteria,
      assigneeGids: remaining.length > 0 ? remaining : null,
    });
  };

  const handleUnassignedToggle = (selected: boolean): void => {
    onChange({ ...criteria, assigneeGids: selected ? "unassigned" : null });
  };

  /* ------------------------------------------------------------------ */
  /* Project                                                             */
  /* ------------------------------------------------------------------ */

  const handleProjectToggle = (gid: string, selected: boolean): void => {
    if (selected) {
      onChange({
        ...criteria,
        projectGids: [...selectedProjectGids, gid],
      });
      return;
    }
    const remaining = selectedProjectGids.filter(
      (existing) => existing !== gid,
    );
    onChange({
      ...criteria,
      projectGids: remaining.length > 0 ? remaining : null,
    });
  };

  /* ------------------------------------------------------------------ */
  /* Completion state                                                    */
  /* ------------------------------------------------------------------ */

  const handleCompletionChange = (value: string): void => {
    if (value === "incomplete" || value === "complete") {
      onChange({ ...criteria, completionState: value });
      return;
    }
    onChange({ ...criteria, completionState: null });
  };

  /* ------------------------------------------------------------------ */
  /* Render                                                              */
  /* ------------------------------------------------------------------ */

  const isCustomRange = dateRange?.preset === "custom";

  return (
    <section
      className="td-filter-bar"
      data-testid="filter-bar"
      aria-label="Filters"
    >
      <h2>Filters</h2>

      <fieldset
        className="td-filter-bar__group"
        data-testid="filter-date-range"
      >
        <legend>Date range</legend>
        {/* FR-033 — the date basis is explicit: the range is matched on
            the due date, never on a blend of dates. */}
        <p className="td-filter-bar__hint">
          Tasks are matched on their due date.
        </p>
        <select
          id="filter-date-range-preset"
          className="td-filter-bar__select"
          data-testid="filter-date-range-preset"
          aria-label="Date range"
          value={dateRange?.preset ?? ""}
          onChange={(event) => {
            handleDateRangePresetChange(event.target.value);
          }}
        >
          <option value="">{ANY_TIME_LABEL}</option>
          {DATE_RANGE_PRESETS.map((preset) => (
            <option key={preset} value={preset}>
              {PRESET_LABELS[preset]}
            </option>
          ))}
          <option value="custom">{CUSTOM_RANGE_LABEL}</option>
        </select>
        {isCustomRange ? (
          <div className="td-filter-bar__custom-range">
            <label
              className="td-filter-bar__field"
              htmlFor="filter-date-range-start"
            >
              From
              <input
                id="filter-date-range-start"
                className="td-filter-bar__date-input"
                data-testid="filter-date-range-start"
                type="date"
                value={dateRange?.start ?? ""}
                onChange={(event) => {
                  handleCustomStartChange(event.target.value);
                }}
              />
            </label>
            <label
              className="td-filter-bar__field"
              htmlFor="filter-date-range-end"
            >
              To
              <input
                id="filter-date-range-end"
                className="td-filter-bar__date-input"
                data-testid="filter-date-range-end"
                type="date"
                value={dateRange?.end ?? ""}
                onChange={(event) => {
                  handleCustomEndChange(event.target.value);
                }}
              />
            </label>
          </div>
        ) : null}
      </fieldset>

      <fieldset className="td-filter-bar__group" data-testid="filter-assignee">
        <legend>Assignee</legend>
        <label
          className="td-filter-bar__option"
          htmlFor="filter-assignee-unassigned"
        >
          <input
            id="filter-assignee-unassigned"
            className="td-filter-bar__checkbox"
            data-testid="filter-assignee-unassigned"
            type="checkbox"
            checked={unassignedSelected}
            onChange={(event) => {
              handleUnassignedToggle(event.target.checked);
            }}
          />
          <span>Unassigned</span>
        </label>
        {users.map((user) => (
          <label
            key={user.gid}
            className="td-filter-bar__option"
            htmlFor={`filter-assignee-${user.gid}`}
          >
            <input
              id={`filter-assignee-${user.gid}`}
              className="td-filter-bar__checkbox"
              data-testid={`filter-assignee-${user.gid}`}
              type="checkbox"
              checked={selectedAssigneeGids.includes(user.gid)}
              onChange={(event) => {
                handleAssigneeToggle(user.gid, event.target.checked);
              }}
            />
            <span>{user.name}</span>
          </label>
        ))}
      </fieldset>

      <fieldset className="td-filter-bar__group" data-testid="filter-project">
        <legend>Project</legend>
        {projects.map((project) => (
          <label
            key={project.gid}
            className="td-filter-bar__option"
            htmlFor={`filter-project-${project.gid}`}
          >
            <input
              id={`filter-project-${project.gid}`}
              className="td-filter-bar__checkbox"
              data-testid={`filter-project-${project.gid}`}
              type="checkbox"
              checked={selectedProjectGids.includes(project.gid)}
              onChange={(event) => {
                handleProjectToggle(project.gid, event.target.checked);
              }}
            />
            <span>{project.name}</span>
          </label>
        ))}
      </fieldset>

      <fieldset
        className="td-filter-bar__group"
        data-testid="filter-completion"
      >
        <legend>Completion</legend>
        <select
          id="filter-completion-state"
          className="td-filter-bar__select"
          data-testid="filter-completion-state"
          aria-label="Completion state"
          value={criteria.completionState ?? ""}
          onChange={(event) => {
            handleCompletionChange(event.target.value);
          }}
        >
          <option value="">{ALL_TASKS_LABEL}</option>
          <option value="incomplete">Incomplete</option>
          <option value="complete">Complete</option>
        </select>
      </fieldset>
    </section>
  );
}
