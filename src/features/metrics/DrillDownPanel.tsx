/**
 * BSOD-321 (T081) — `DrillDownPanel`, the shared drill-down panel (US4).
 *
 * Spec / contract references
 * --------------------------
 * - FR-052 (spec.md): "Every summary card, chart series, table row, and
 *   ranked result MUST support drill-down to its contributing tasks
 *   wherever that is practical for the metric." This module IS that
 *   drill-down surface, and it is shared: the US4 chart's figures, the
 *   US5 backlog figures, the US7 delivery-quality figures, the US8
 *   diagnostics figures and the US9 task-health figures all open it.
 * - FR-053 (spec.md): the task detail reached via drill-down MUST show
 *   sufficient source fields — project memberships, dates, assignee,
 *   priority, completion state, estimate/actual, dependencies — for the
 *   user to verify why a task was included in, or excluded from, the
 *   metric they drilled from. The table and the drawer do that work;
 *   this panel places them.
 * - FR-037 (spec.md): a drill-down MUST show all of a task's project
 *   memberships. The drawer shows them; the panel never filters a
 *   membership away.
 * - FR-058 (spec.md): the effort sums leave out the tasks that carry no
 *   estimate, and the exclusion is disclosed rather than hidden. The
 *   panel discloses it too, so the reader can tell why a list holds two
 *   tasks and a figure holds 30 minutes.
 * - Constitution Principle VII (Honest UX — drill parity): the panel
 *   states the figure the list stands for AND what the list itself adds
 *   up to, and it never claims a match it has not checked.
 *
 * What this module owns
 * ---------------------
 * The drill-down surface: the heading of what was drilled, the figure
 * the user clicked, the list of contributing tasks, and the detail of
 * the task the user then chooses.
 *
 * What this module deliberately does NOT own
 * ------------------------------------------
 * - The metric. The figure and the contributing task list both come
 *   from the metric that produced them (T075 / BSOD-318 and the
 *   per-metric calculators that follow). The panel counts nothing of its
 *   own: it re-aggregates the list ONLY to compare it with the figure
 *   the user was shown, and it publishes that comparison.
 * - The task surfaces. The list is `TaskTable` (T066 / BSOD-315) and
 *   the detail is `TaskDetailDrawer` (T067 / BSOD-316). The panel
 *   composes them; it does not re-implement either one.
 * - The drill request. The chart emits it (T076 / BSOD-319) and the
 *   dashboard decides which figure it refers to; the panel is handed
 *   the figure and the task list behind it.
 * - Any I/O. The panel renders the tasks it is handed; the caller owns
 *   the cache read.
 *
 * Drill parity
 * ------------
 * The panel is the place where a drilled figure and the list behind it
 * are compared, so the comparison is published rather than implied:
 *
 * - A count figure: the list must hold as many tasks as the figure
 *   counts, and the panel says so in words.
 * - An effort figure: the listed estimates must add up to the figure,
 *   with the tasks that carry no estimate left out of the sum and
 *   disclosed (FR-058).
 * - When the two do not agree, the panel says that too. A panel that
 *   asserted a match it had not checked would be the very drift it
 *   exists to reveal.
 *
 * Reuse
 * -----
 * The panel is generic: it never mentions a measure, a bucket or a
 * grouping dimension. The caller hands it a figure (a label, a number
 * and its unit) and the task gids behind that figure, and the panel
 * does the rest. The per-metric drill panels of the later phases reuse
 * it as-is.
 *
 * Boundary
 * --------
 * `src/features/metrics/**` is the plan-documented home for the
 * metrics React UI. This module imports the shared task surfaces from
 * `src/features/tasks/**` — the reuse T081 asks for — plus the domain's
 * date vocabulary, the cached `Task` shape (a type-only import: no
 * database, no Dexie at runtime) and the shared formatters. It performs
 * no I/O and makes no network call.
 */
import { useState, type ReactElement } from "react";

import type { Task } from "../../data/db/schema";
import type { ISODateTime, TimezoneSetting } from "../../domain/types";
import { formatDuration } from "../../shared/format";
import type { FilterOption } from "../tasks/FilterBar";
import { TaskDetailDrawer } from "../tasks/TaskDetailDrawer";
import { TaskTable, type TaskTableTask } from "../tasks/TaskTable";

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * How a figure's number reads: an item count, or estimated effort in
 * minutes. The two are never blended — a count figure and an effort
 * figure are two views of the same list, and the panel states which
 * one it is showing.
 */
export type DrillDownFigureUnit = "count" | "minutes";

/**
 * The figure the user drilled into: the number the metric displayed,
 * with the words that name it.
 *
 * The value is the metric's own — the panel never counts the list to
 * produce it. It is carried alongside the list so the panel can compare
 * the two and publish the comparison.
 */
export interface DrillDownFigure {
  /** The name of the figure — what the user clicked ("Items added"). */
  readonly label: string;
  /** The number the metric displayed for this figure. */
  readonly value: number;
  /** How the number reads: an item count, or estimated effort. */
  readonly unit: DrillDownFigureUnit;
}

/**
 * The props `<DrillDownPanel />` consumes. Every field is `readonly`
 * and consumed via `Readonly<Props>` per the project-wide convention.
 */
export interface DrillDownPanelProps {
  /**
   * What the user drilled into — the heading of the panel ("Items added
   * — 4 Mar 2026"). The panel names it; the caller composes it.
   */
  readonly title: string;
  /**
   * The figure the user drilled into: the number the metric displayed.
   */
  readonly figure: DrillDownFigure;
  /**
   * The exact contributing task gids behind the figure — the metric's
   * own drill-down set, in the metric's own order.
   */
  readonly taskGids: readonly string[];
  /**
   * The cached task rows the panel resolves the gids against. The whole
   * set is handed on, so the drawer can name a task's dependencies.
   */
  readonly tasks: readonly Task[];
  /** The people, so an assignee `gid` can be shown by name. */
  readonly users: readonly FilterOption[];
  /** The projects, so a project `gid` can be shown by name. */
  readonly projects: readonly FilterOption[];
  /**
   * The human name of each priority option, keyed by the priority
   * option `gid`. Asana's priority option ids carry no readable name,
   * so without this map the column shows the raw id.
   */
  readonly priorityLabels?: Readonly<Record<string, string>>;
  /**
   * The timezone basis the displayed dates are evaluated under
   * (FR-029/FR-030). Defaults to `"local"`, the app-wide default.
   */
  readonly timezone?: TimezoneSetting;
  /** Dismiss the panel when its caller supports closing the drill-down. */
  readonly onClose?: () => void;
}

/* -------------------------------------------------------------------------- */
/* Copy                                                                        */
/* -------------------------------------------------------------------------- */

/** The heading of the list of tasks the user can open. */
const TASK_DETAIL_HEADING = "Task detail";

/** The hint above the list of tasks the user can open. */
const TASK_DETAIL_HINT = "Choose a task to see its full detail.";

/** Shown when the figure has no task behind it. */
const EMPTY_MESSAGE = "No tasks are behind this figure.";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The table row for a cached task.
 *
 * The cached row already holds every field the table reads, so the row
 * copies them rather than re-deriving them: nothing can be dropped on
 * the way to the table. The cached dates are ISO instants by the
 * cache's own contract, so they satisfy the domain's branded instant
 * without conversion — the brand marks the type, not the wire form.
 */
function toTableRow(task: Task): TaskTableTask {
  return {
    gid: task.gid,
    name: task.name,
    assigneeGid: task.assigneeGid,
    projectGids: task.projectGids,
    createdAt: task.createdAt as ISODateTime,
    dueAt: task.dueAt === null ? null : (task.dueAt as ISODateTime),
    completedAt:
      task.completedAt === null ? null : (task.completedAt as ISODateTime),
    priorityOptionId: task.priorityOptionId,
    estimatedMinutes: task.estimatedMinutes,
    actualMinutes: task.actualMinutes,
  };
}

/**
 * The figure as the reader sees it: a count of tasks, or a duration.
 */
function figureValueText(figure: DrillDownFigure): string {
  if (figure.unit === "count") {
    return `${figure.value} ${figure.value === 1 ? "task" : "tasks"}`;
  }
  return formatDuration(figure.value);
}

/**
 * The sum of the estimates of the listed tasks. A task that carries no
 * estimate contributes nothing to an effort sum (FR-058) — it is
 * counted in the item figure and left out of the effort figure.
 */
function estimateTotal(rows: readonly TaskTableTask[]): number {
  return rows.reduce((total, row) => total + (row.estimatedMinutes ?? 0), 0);
}

/**
 * The comparison of the list with the figure the user was shown.
 *
 * The comparison is published in words, because the drill-down exists
 * so the user can check the figure. A list that does not add up is
 * said so — the panel never claims a match it has not checked.
 */
function paritySentence(
  figure: DrillDownFigure,
  rows: readonly TaskTableTask[],
): string {
  if (figure.unit === "count") {
    const held = rows.length;
    if (held === figure.value) {
      if (held === 0) {
        return "The figure counts no tasks, and this list is empty.";
      }
      return `These are the same ${held} ${
        held === 1 ? "task" : "tasks"
      } the figure counts.`;
    }
    return `This list holds ${held} ${
      held === 1 ? "task" : "tasks"
    }; the figure counts ${figure.value}.`;
  }

  const total = estimateTotal(rows);
  if (total === figure.value) {
    return `These estimates add up to the same ${formatDuration(
      total,
    )} the figure shows.`;
  }
  return `These estimates add up to ${formatDuration(
    total,
  )}; the figure shows ${formatDuration(figure.value)}.`;
}

/**
 * The disclosure of the tasks left out of an effort sum (FR-058). The
 * reader can then tell why the list holds two tasks and the figure
 * holds thirty minutes.
 */
function exclusionSentence(rows: readonly TaskTableTask[]): string | null {
  const unestimated = rows.filter(
    (row) => row.estimatedMinutes === null,
  ).length;
  if (unestimated === 0) {
    return null;
  }
  const noun = rows.length === 1 ? "task" : "tasks";
  const verb = unestimated === 1 ? "carries" : "carry";
  const auxiliary = unestimated === 1 ? "is" : "are";
  return `${unestimated} of the ${rows.length} listed ${noun} ${verb} no estimate and ${auxiliary} left out of the effort figure.`;
}

/**
 * The disclosure of the drill-down tasks the local cache does not hold.
 * A task the panel cannot show is still a task the figure counted, so
 * it is named rather than dropped.
 */
function missingSentence(missing: number): string {
  return `${missing} ${
    missing === 1 ? "task" : "tasks"
  } behind this figure could not be found in the local cache.`;
}

/* -------------------------------------------------------------------------- */
/* Component                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The drill-down panel: the figure the user drilled into, the tasks
 * behind it, and the detail of the task the user then chooses.
 */
export function DrillDownPanel({
  title,
  figure,
  taskGids,
  tasks,
  users,
  projects,
  priorityLabels = {},
  timezone = "local",
  onClose,
}: Readonly<DrillDownPanelProps>): ReactElement {
  const [selectedGid, setSelectedGid] = useState<string | null>(null);

  const byGid = new Map<string, Task>();
  for (const task of tasks) {
    byGid.set(task.gid, task);
  }

  // The drill-down set, in the metric's own order, with a task listed
  // once however many times the set names it.
  const listed: Task[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const gid of taskGids) {
    if (seen.has(gid)) {
      continue;
    }
    seen.add(gid);
    const task = byGid.get(gid);
    if (task === undefined) {
      missing.push(gid);
      continue;
    }
    listed.push(task);
  }

  const rows = listed.map(toTableRow);
  const selected = listed.find((task) => task.gid === selectedGid);
  const exclusion = figure.unit === "minutes" ? exclusionSentence(rows) : null;

  return (
    <section
      className="td-drill-down-panel"
      data-testid="drill-down-panel"
      aria-label={title}
    >
      <h2
        className="td-drill-down-panel__heading"
        data-testid="drill-down-panel-title"
      >
        {title}
      </h2>
      {onClose !== undefined ? (
        <button
          type="button"
          className="td-drill-down-panel__task-button"
          data-testid="drill-down-panel-close"
          onClick={onClose}
        >
          Close details
        </button>
      ) : null}

      <p
        className="td-drill-down-panel__figure"
        data-testid="drill-down-panel-figure"
      >
        <span className="td-drill-down-panel__figure-label">
          {figure.label}
        </span>
        <span
          className="td-drill-down-panel__figure-value"
          data-testid="drill-down-panel-figure-value"
        >
          {figureValueText(figure)}
        </span>
      </p>

      <p
        className="td-drill-down-panel__parity"
        data-testid="drill-down-panel-parity"
      >
        {paritySentence(figure, rows)}
      </p>

      {exclusion !== null ? (
        <p
          className="td-drill-down-panel__exclusion"
          data-testid="drill-down-panel-exclusion"
        >
          {exclusion}
        </p>
      ) : null}

      {missing.length > 0 ? (
        <p
          className="td-drill-down-panel__missing"
          data-testid="drill-down-panel-missing"
        >
          {missingSentence(missing.length)}
        </p>
      ) : null}

      {listed.length === 0 ? (
        <p
          className="td-drill-down-panel__empty"
          data-testid="drill-down-panel-empty"
        >
          {EMPTY_MESSAGE}
        </p>
      ) : (
        <>
          <h3 className="td-drill-down-panel__task-heading">
            {TASK_DETAIL_HEADING}
          </h3>
          <p className="td-drill-down-panel__task-hint">{TASK_DETAIL_HINT}</p>
          <ul
            className="td-drill-down-panel__task-list"
            data-testid="drill-down-panel-task-list"
          >
            {listed.map((task) => (
              <li key={task.gid} className="td-drill-down-panel__task">
                <button
                  type="button"
                  className="td-drill-down-panel__task-button"
                  data-testid="drill-down-panel-task"
                  data-task-gid={task.gid}
                  onClick={() => {
                    setSelectedGid(task.gid);
                  }}
                >
                  {task.name}
                </button>
              </li>
            ))}
          </ul>

          {/* The list behind the figure — the shared task table, with
              the source fields the user verifies the metric against
              (FR-053). No criterion is applied: the drill-down set is
              already the metric's own answer, and filtering it again
              could drop a task the figure counted. */}
          <TaskTable
            tasks={rows}
            criteria={{}}
            users={users}
            projects={projects}
            priorityLabels={priorityLabels}
            timezone={timezone}
          />

          {selected !== undefined ? (
            <TaskDetailDrawer
              task={selected}
              users={users}
              projects={projects}
              tasks={tasks}
              priorityLabels={priorityLabels}
              timezone={timezone}
              onClose={() => {
                setSelectedGid(null);
              }}
            />
          ) : null}
        </>
      )}
    </section>
  );
}
