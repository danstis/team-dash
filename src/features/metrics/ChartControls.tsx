/**
 * BSOD-320 (T080) — `ChartControls`, the shared chart controls (US4).
 *
 * Spec / contract references
 * --------------------------
 * - FR-050 (spec.md): the system MUST support grouping and comparison
 *   across at least team member, team, project, portfolio and priority.
 * - FR-060 (spec.md): the work-added / work-completed metric can be
 *   split by team member, team, project, portfolio and priority.
 * - FR-061 (spec.md): the item-count view and the estimated-effort view
 *   are two separate views of the same figure, never one blended
 *   number — so the switch between them is a control of its own.
 * - FR-088 (spec.md): the controls are operable from the keyboard, carry
 *   programmatic labels and never tell their state by colour alone.
 *
 * What this module owns
 * ---------------------
 * The two controls every metric chart needs: the switch between the
 * item-count view and the estimated-effort view, and the choice of the
 * grouping dimension.
 *
 * What this module deliberately does NOT own
 * ------------------------------------------
 * - The state. Both controls are CONTROLLED: they render the state they
 *   are given and report every change through a callback, so the page
 *   that owns the state stays the single source of truth (DESIGN.md ›
 *   Interaction & Copy › The State Is One Source Rule).
 * - The metric. A control names a dimension; the domain metric decides
 *   what that dimension means, and the chart draws the result.
 * - The chart. `WorkAddedCompletedChart` (T076 / BSOD-319) reads the
 *   state the controls report — the same view and the same dimension
 *   the caller holds.
 *
 * The vocabulary
 * --------------
 * `ChartView` is `"count" | "effort"` and `ChartGroupBy` is the
 * standard grouping set. Both are structurally identical to the types
 * the US4 chart and its metric use (`WorkAddedCompletedView` and
 * `WorkAddedCompletedGroupBy`), so the controls hand their state
 * straight to the chart with no translation layer.
 *
 * The dimension names are the domain's own: the reporting team is
 * `reportingTeam`, not `team`. The T080 task row says "team"; the
 * domain's `WorkAddedCompletedGroupBy` says `reportingTeam`, and the
 * domain wins — the spec wording is reconciled separately.
 *
 * Reuse
 * -----
 * The controls are not US4-shaped. `GroupBySelector` is generic in the
 * caller's dimension union, so the backlog view (US5 — FR-065: the
 * workspace, the reporting team, the Asana team, the project, the
 * portfolio, the assignee) and the delivery view (US8) offer their own
 * dimensions through the same control. T120 adds the Person Group
 * dimension (FR-042d) to this module's own union.
 *
 * Accessibility
 * -------------
 * - The toggle is a native radio group inside a `fieldset` with a
 *   `legend`, so it is labelled, operable with the arrow keys and
 *   announced with its checked state for free (FR-088).
 * - The selector is a native `select` with a visible `label`, so it is
 *   labelled and operable from the keyboard (FR-088).
 * - Both state their choice in words — the choices are text, and the
 *   selected one is the checked radio — so no meaning is carried by
 *   colour alone (FR-088).
 * - The colours are the app's own: the controls are styled by the
 *   global form styles, which read the `--td-*` tokens, so the
 *   contrast is the app's checked one.
 *
 * Boundary
 * --------
 * `src/features/metrics/**` is the plan-documented home for the metrics
 * React UI. This module imports nothing but React: it performs no I/O,
 * touches no database and makes no network call.
 */
import { useId, type ChangeEvent, type ReactElement } from "react";

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Which of the two figures of a bucket a chart shows (FR-061): the
 * number of items, or their estimated effort. The two are never
 * blended into one number.
 */
export type ChartView = "count" | "effort";

/**
 * The standard grouping dimensions the metric charts can be split by
 * (FR-050, FR-060): team member, team, project, portfolio and priority.
 */
export type ChartGroupBy =
  "assignee" | "reportingTeam" | "project" | "portfolio" | "priority";

/**
 * One choice the grouping selector offers: the dimension's value and
 * the words shown for it. `value` is `undefined` for the explicit
 * "no grouping" choice — the workspace-level view every metric has.
 *
 * The type parameter is the caller's dimension union, so a view that
 * groups differently (US5, US8) offers its own choices with the same
 * control.
 */
export interface ChartGroupByOption<
  T extends string | undefined = ChartGroupBy,
> {
  /** The dimension's value — `undefined` for the "no grouping" choice. */
  readonly value: T | undefined;
  /** The words shown for the choice. */
  readonly label: string;
}

/**
 * The props `<CountEffortToggle />` consumes. Every field is `readonly`
 * and consumed via `Readonly<Props>` per the project-wide convention.
 */
export interface CountEffortToggleProps {
  /**
   * The view currently on show. The toggle renders exactly this
   * selection, so the caller owns the single source of truth.
   */
  readonly value: ChartView;
  /**
   * Called with the view the user picked. The toggle never changes its
   * own state: it reports the choice and waits to be told what to show.
   */
  readonly onChange: (view: ChartView) => void;
  /**
   * The legend of the radio group — what the group of choices is called.
   * Defaults to "Show".
   */
  readonly legend?: string;
  /** The words for the item-count choice. Defaults to "Items". */
  readonly countLabel?: string;
  /**
   * The words for the estimated-effort choice. Defaults to
   * "Estimated effort".
   */
  readonly effortLabel?: string;
  /**
   * The name of the radio group. It defaults to a name unique to this
   * instance, so two toggles on one page stay two radio groups — the
   * delivery view (US8) and the US4 chart can share a screen.
   */
  readonly name?: string;
  /** Greys the control out and takes it out of the keyboard path. */
  readonly disabled?: boolean;
}

/**
 * The props `<GroupBySelector />` consumes. Every field is `readonly`
 * and consumed via `Readonly<Props>` per the project-wide convention.
 */
export interface GroupBySelectorProps<
  T extends string | undefined = ChartGroupBy,
> {
  /**
   * The dimension in force — `undefined` for the workspace-level view.
   */
  readonly value: T | undefined;
  /**
   * Called with the dimension the user picked (`undefined` for the
   * workspace-level view). The selector never changes its own state.
   */
  readonly onChange: (groupBy: T | undefined) => void;
  /**
   * The dimensions offered. Defaults to the standard set — team
   * member, team, project, portfolio, priority — with the explicit
   * "no grouping" choice in front of them.
   */
  readonly options?: readonly ChartGroupByOption<T>[];
  /**
   * The words shown above the control. Defaults to "Group by".
   */
  readonly label?: string;
  /**
   * The id of the control, when the caller needs to point at it.
   * Defaults to an id unique to this instance.
   */
  readonly id?: string;
  /** Greys the control out and takes it out of the keyboard path. */
  readonly disabled?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Copy                                                                        */
/* -------------------------------------------------------------------------- */

/** The legend of the count↔effort radio group. */
const DEFAULT_TOGGLE_LEGEND = "Show";

/** The words for the item-count choice. */
const DEFAULT_COUNT_LABEL = "Items";

/** The words for the estimated-effort choice. */
const DEFAULT_EFFORT_LABEL = "Estimated effort";

/** The words above the grouping selector. */
const DEFAULT_GROUP_BY_LABEL = "Group by";

/** The words for the explicit "no grouping" choice. */
const NO_GROUPING_LABEL = "No grouping";

/**
 * The choices the grouping selector offers when the caller names none:
 * the standard grouping dimensions (FR-050, FR-060), with the explicit
 * "no grouping" choice in front of them — the workspace-level view
 * every metric has, and the one the charts read as an absent
 * dimension.
 */
const DEFAULT_GROUP_BY_OPTIONS: readonly ChartGroupByOption[] = [
  { value: undefined, label: NO_GROUPING_LABEL },
  { value: "assignee", label: "Team member" },
  { value: "reportingTeam", label: "Team" },
  { value: "project", label: "Project" },
  { value: "portfolio", label: "Portfolio" },
  { value: "priority", label: "Priority" },
];

/* -------------------------------------------------------------------------- */
/* Component                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The count↔effort switch (FR-061).
 *
 * A native radio group in a `fieldset` with a `legend`, rather than a
 * custom widget: the labelling, the arrow-key operation, the tab order
 * and the checked-state announcement all come from the browser, and the
 * app's global form styles theme it like every other control.
 */
export function CountEffortToggle({
  value,
  onChange,
  legend = DEFAULT_TOGGLE_LEGEND,
  countLabel = DEFAULT_COUNT_LABEL,
  effortLabel = DEFAULT_EFFORT_LABEL,
  name,
  disabled = false,
}: Readonly<CountEffortToggleProps>): ReactElement {
  const generatedId = useId();
  const groupName = name ?? `chart-view-${generatedId}`;

  const options: readonly { value: ChartView; label: string }[] = [
    { value: "count", label: countLabel },
    { value: "effort", label: effortLabel },
  ];

  return (
    <fieldset
      className="td-chart-controls__toggle"
      data-testid="count-effort-toggle"
      disabled={disabled}
    >
      <legend>{legend}</legend>
      {options.map((option) => {
        const optionId = `${groupName}-${option.value}`;
        return (
          <label key={option.value} htmlFor={optionId}>
            <input
              id={optionId}
              type="radio"
              name={groupName}
              value={option.value}
              checked={value === option.value}
              disabled={disabled}
              onChange={() => {
                onChange(option.value);
              }}
            />{" "}
            {option.label}
          </label>
        );
      })}
    </fieldset>
  );
}

/**
 * The grouping selector (FR-050, FR-060).
 *
 * A native `select` with a visible `label`, so it is named, operable
 * from the keyboard and announced with its selected option for free.
 * The dimensions it offers are the caller's: the standard set by
 * default, the backlog view's own set when that view passes one.
 */
export function GroupBySelector<T extends string | undefined = ChartGroupBy>({
  value,
  onChange,
  options,
  label = DEFAULT_GROUP_BY_LABEL,
  id,
  disabled = false,
}: Readonly<GroupBySelectorProps<T>>): ReactElement {
  const generatedId = useId();
  const controlId = id ?? `chart-group-by-${generatedId}`;

  const resolvedOptions: readonly ChartGroupByOption<T>[] =
    options ??
    // The default list is written in the standard vocabulary; the cast
    // widens it to the caller's dimension union, which holds the same
    // dimensions for every view that does not name its own.
    (DEFAULT_GROUP_BY_OPTIONS as readonly ChartGroupByOption<T>[]);

  const handleChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    const raw = event.target.value;
    const chosen = resolvedOptions.find(
      (option) => (option.value ?? "") === raw,
    );
    if (chosen === undefined) {
      // A value the control does not offer cannot name a dimension;
      // ignoring it leaves the dimension in force untouched.
      return;
    }
    onChange(chosen.value);
  };

  return (
    <div className="td-chart-controls__group-by">
      <label htmlFor={controlId}>{label}</label>
      <select
        id={controlId}
        className="td-chart-controls__select"
        data-testid="group-by-selector"
        value={value ?? ""}
        disabled={disabled}
        onChange={handleChange}
      >
        {resolvedOptions.map((option) => (
          <option
            key={option.value ?? "none"}
            value={option.value ?? ""}
            data-group-by={option.value ?? "none"}
          >
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
