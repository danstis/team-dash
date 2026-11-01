/**
 * BSOD-315 (T066) — `TaskTable`, the filtered task list (US3).
 *
 * Spec / contract references
 * --------------------------
 * - FR-047 (spec.md): the system MUST support composable filtering by
 *   date range, assignee, project, priority, completion state and the
 *   other documented dimensions.
 * - FR-048 (spec.md): the filters combine, and the result is what the
 *   user sees.
 * - FR-049 (spec.md): "Wherever a filter changes the denominator used by
 *   a displayed metric (e.g. restricting to estimated tasks only), the
 *   system MUST make that denominator change visible to the user." The
 *   table therefore states how many of the tasks it holds are currently
 *   shown.
 * - FR-053 (spec.md): the task table reached via drill-down must show
 *   sufficient source fields — project memberships, dates, assignee,
 *   priority, completion state, estimate/actual — for the user to verify
 *   why a task was included.
 *
 * What this module owns
 * ---------------------
 * The table of tasks, filtered by the criteria it is given. It applies
 * the T065 predicate contract (`src/domain/filtering/filters.ts`) and
 * renders each surviving task with the source fields the user needs to
 * judge it.
 *
 * What this module deliberately does NOT own
 * ------------------------------------------
 * - The predicate logic. `filterTasks` from the domain contract answers
 *   "does this task survive the filters?"; the table never re-derives a
 *   rule of its own, so the list can never disagree with the domain.
 * - The filters themselves (that is `FilterBar`), the active-filter list
 *   (`ActiveFiltersList`), and the zero-match state (T068 / BSOD-317).
 * - Any I/O. The table renders the tasks it is handed; the caller owns
 *   the cache read.
 *
 * Denominator honesty
 * -------------------
 * The summary line states both numbers — the tasks shown and the tasks
 * the table holds — so a narrowed list is visibly narrower (FR-049). A
 * table that silently showed three of five tasks would let the user
 * read the three as the whole.
 *
 * Missing values
 * --------------
 * The columns distinguish the states the domain distinguishes: a task
 * with no estimate is "Not estimated", a task whose time tracking Asana
 * does not expose is "Not available", and a task with no recorded time
 * is "Not recorded". A dash would have hidden the difference between
 * "no estimate" and "an estimate of zero minutes".
 *
 * Boundary
 * --------
 * `src/features/tasks/**` is the plan-documented home for the task-list
 * React UI. This module imports the domain's filter contract, the
 * domain's types, and the shared formatters. It performs no I/O and
 * makes no network call.
 */
import type { ReactElement } from "react";

import {
  type FilterableTask,
  filterTasks,
} from "../../domain/filtering/filters";
import type {
  FilterCriteria,
  ISODateTime,
  TimezoneSetting,
} from "../../domain/types";
import { formatDate, formatDuration } from "../../shared/format";
import type { FilterOption } from "./FilterBar";

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A task as the table renders it: the domain's filterable row plus the
 * two fields the table shows but the filter contract never reads — the
 * task's name and its recorded time.
 *
 * Extending `FilterableTask` rather than restating it is deliberate: the
 * row the table renders IS the row the domain filters, so there is no
 * mapping layer that could drop a field the predicates depend on.
 */
export interface TaskTableTask extends FilterableTask {
  /** The task's name, as shown in the first column. */
  readonly name: string;
  /**
   * The recorded time on the task, or `null` when nothing was recorded,
   * or `"unavailable"` when Asana does not expose time tracking for the
   * task — three states the domain keeps apart.
   */
  readonly actualMinutes: number | null | "unavailable";
}

/**
 * The props `<TaskTable />` consumes. Every field is `readonly` and
 * consumed via `Readonly<Props>` per the project-wide convention.
 */
export interface TaskTableProps {
  /** The tasks the table holds — the full set, before filtering. */
  readonly tasks: readonly TaskTableTask[];
  /** The criteria currently in force; the table shows what survives them. */
  readonly criteria: FilterCriteria;
  /** The people, so an assignee `gid` can be shown by name. */
  readonly users: readonly FilterOption[];
  /** The projects, so a project `gid` can be shown by name. */
  readonly projects: readonly FilterOption[];
  /**
   * The human name of each priority option, keyed by the priority
   * option `gid`. Asana's priority option ids carry no readable name,
   * so without this map the column shows the raw id; the caller
   * supplies the names when it has them.
   */
  readonly priorityLabels?: Readonly<Record<string, string>>;
  /**
   * The timezone basis the range bounds and the displayed dates are
   * evaluated under (FR-029/FR-030). Defaults to `"local"`, the
   * app-wide default.
   */
  readonly timezone?: TimezoneSetting;
  /**
   * The instant the overdue state is measured against. Required only
   * when the criteria carry an overdue filter — the domain never reads
   * the wall clock, so the state is reproducible from its inputs.
   */
  readonly now?: ISODateTime;
  /**
   * Called with the `gid` of the task whose name the reader activated.
   *
   * The table is a *presentational* surface: it owns no open/closed
   * state of its own, so the drill-down drawer that shows the task is
   * mounted by the caller (the dashboard, or the drill-down panel).
   * When the callback is absent the task name renders as plain text and
   * the table offers no drill-down — a drill-down that leads nowhere is
   * a dead end.
   */
  readonly onSelectTask?: (taskGid: string) => void;
}

/* -------------------------------------------------------------------------- */
/* Copy                                                                        */
/* -------------------------------------------------------------------------- */

/** The heading of the table surface. */
const TABLE_HEADING = "Tasks";

/** The caption of the table itself. */
const TABLE_CAPTION = "Tasks";

/** Shown for a task with no assignee. */
const UNASSIGNED_VALUE = "Unassigned";

/** Shown for a task that belongs to no project. */
const NO_PROJECT_VALUE = "No project";

/** Shown for a task with no priority. */
const NO_PRIORITY_VALUE = "No priority";

/** Shown for a task with no due date. */
const NO_DUE_DATE_VALUE = "No due date";

/** Shown for a task that has not been completed. */
const NOT_COMPLETED_VALUE = "Not completed";

/** Shown for a task with no estimate. */
const NOT_ESTIMATED_VALUE = "Not estimated";

/** Shown for a task with no recorded time. */
const NOT_RECORDED_VALUE = "Not recorded";

/** Shown when Asana does not expose time tracking for the task. */
const NOT_AVAILABLE_VALUE = "Not available";

/* -------------------------------------------------------------------------- */
/* Cell helpers                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Resolves a `gid` to a human name, falling back to the raw `gid` when
 * the option is not in the list the caller supplied.
 */
function nameFor(options: readonly FilterOption[], gid: string): string {
  return options.find((option) => option.gid === gid)?.name ?? gid;
}

/** The assignee's name, or the "Unassigned" state. */
function assigneeName(
  task: TaskTableTask,
  users: readonly FilterOption[],
): string {
  return task.assigneeGid === null
    ? UNASSIGNED_VALUE
    : nameFor(users, task.assigneeGid);
}

/**
 * The names of every project the task belongs to. A task may belong to
 * several projects, and the drill-down must show them all (FR-037), so
 * the cell lists every membership rather than the first one.
 */
function projectNames(
  task: TaskTableTask,
  projects: readonly FilterOption[],
): string {
  if (task.projectGids.length === 0) {
    return NO_PROJECT_VALUE;
  }
  return task.projectGids.map((gid) => nameFor(projects, gid)).join(", ");
}

/**
 * The priority cell of a task.
 *
 * The human name is used when the caller supplied one. Asana's
 * priority option ids carry no readable name, so without a name the raw
 * id is shown in monospace — an unreadable id is still the truth about
 * the task, where a made-up "High" would not be (DESIGN.md › The Raw
 * Means Raw Rule).
 */
function priorityCell(
  task: TaskTableTask,
  priorityLabels: Readonly<Record<string, string>>,
): ReactElement {
  const optionId = task.priorityOptionId;
  if (optionId === null) {
    return <>{NO_PRIORITY_VALUE}</>;
  }
  const label = priorityLabels[optionId];
  if (label !== undefined) {
    return <>{label}</>;
  }
  return <code className="td-task-table__priority-id">{optionId}</code>;
}

/** The estimate as a duration, or the "Not estimated" state. */
function estimateText(task: TaskTableTask): string {
  return task.estimatedMinutes === null
    ? NOT_ESTIMATED_VALUE
    : formatDuration(task.estimatedMinutes);
}

/** The recorded time as a duration, or the state it is in. */
function actualText(task: TaskTableTask): string {
  if (task.actualMinutes === "unavailable") {
    return NOT_AVAILABLE_VALUE;
  }
  if (task.actualMinutes === null) {
    return NOT_RECORDED_VALUE;
  }
  return formatDuration(task.actualMinutes);
}

/* -------------------------------------------------------------------------- */
/* Component                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The filtered task list.
 *
 * The filtering is the domain contract's job: `filterTasks` applies the
 * criteria to the rows, and the table renders whatever survives. The
 * summary states the denominator next to the visible count so a
 * narrowed list is visibly narrowed (FR-049).
 */
export function TaskTable({
  tasks,
  criteria,
  users,
  projects,
  priorityLabels = {},
  timezone = "local",
  now,
  onSelectTask,
}: Readonly<TaskTableProps>): ReactElement {
  const visibleTasks = filterTasks(tasks, criteria, { timezone, now });

  return (
    <section
      className="td-task-table"
      data-testid="task-table"
      aria-label="Tasks"
    >
      <h2>{TABLE_HEADING}</h2>
      <p className="td-task-table__summary" data-testid="task-table-summary">
        Showing {visibleTasks.length} of {tasks.length} tasks
      </p>
      <table className="td-task-table__table">
        <caption className="td-task-table__caption">{TABLE_CAPTION}</caption>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Assignee</th>
            <th scope="col">Projects</th>
            <th scope="col">Priority</th>
            <th scope="col">Created</th>
            <th scope="col">Due</th>
            <th scope="col">Completed</th>
            <th scope="col">Status</th>
            <th scope="col">Estimate</th>
            <th scope="col">Actual</th>
          </tr>
        </thead>
        <tbody>
          {visibleTasks.map((task) => (
            <tr key={task.gid} data-testid="task-row" data-task-gid={task.gid}>
              <th scope="row" className="td-task-table__name">
                {onSelectTask === undefined ? (
                  task.name
                ) : (
                  <button
                    type="button"
                    className="td-task-table__select"
                    data-testid="task-row-select"
                    data-task-gid={task.gid}
                    onClick={() => {
                      onSelectTask(task.gid);
                    }}
                  >
                    {task.name}
                  </button>
                )}
              </th>
              <td>{assigneeName(task, users)}</td>
              <td>{projectNames(task, projects)}</td>
              <td>{priorityCell(task, priorityLabels)}</td>
              <td>{formatDate(task.createdAt, timezone)}</td>
              <td>
                {task.dueAt === null
                  ? NO_DUE_DATE_VALUE
                  : formatDate(task.dueAt, timezone)}
              </td>
              <td>
                {task.completedAt === null
                  ? NOT_COMPLETED_VALUE
                  : formatDate(task.completedAt, timezone)}
              </td>
              <td>{task.completedAt === null ? "Incomplete" : "Complete"}</td>
              <td>{estimateText(task)}</td>
              <td>{actualText(task)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
