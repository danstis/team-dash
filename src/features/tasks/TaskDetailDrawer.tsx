/**
 * BSOD-316 (T067) — `TaskDetailDrawer`, the drill-down task detail
 * surface (US3).
 *
 * Spec / contract references
 * --------------------------
 * - FR-037 (spec.md): "When a user drills from an aggregate figure into
 *   task detail, the system MUST show all of that task's project
 *   memberships." A task can sit in several projects at once, and the
 *   drill-down is exactly where the user checks WHY a task counted — so
 *   one membership is never the whole answer.
 * - FR-053 (spec.md): the task detail reached via drill-down MUST show
 *   sufficient source fields (project memberships, dates, assignee,
 *   priority, completion state, estimate/actual, dependencies) for the
 *   user to verify why the task was included in, or excluded from, the
 *   metric they drilled from.
 * - FR-054 (spec.md): each task detail MUST provide a link to the
 *   corresponding task in Asana that does not expose the personal
 *   access token.
 * - FR-009 / FR-010 (spec.md): the token is used for read-only API
 *   access only, and every outbound request that opens a task in Asana
 *   MUST be constructed without embedding the token in the URL or the
 *   request.
 * - FR-014 (spec.md): a subtask's project membership is resolved
 *   against its parent's, so the cached row already carries every
 *   membership a drill-down has to show — the drawer reads them, it
 *   never re-derives them.
 * - Constitution Principle IV (Local-First Privacy) and Principle VII
 *   (Honest UX): the link carries no token, and the detail shows every
 *   membership and every dependency rather than a flattering subset.
 *
 * What this module owns
 * ---------------------
 * The detail of ONE task: its name and id, the source fields the user
 * verifies it against, every project it belongs to, the tasks it
 * depends on, and the link that opens it in Asana.
 *
 * What this module deliberately does NOT own
 * ------------------------------------------
 * - The drill-down itself. The caller decides which task is open (that
 *   is the table's row, or a metric's contributing list) and owns the
 *   open/closed state; the drawer reports a close through `onClose`.
 * - The cache read. The drawer renders the task it is handed — the
 *   cached `Task` row, as-is, with no adapter layer that could drop a
 *   membership.
 * - The name lookups. The caller supplies the people, the projects and
 *   the task set; the drawer only resolves gids to names.
 * - Any I/O. The drawer performs no fetch, opens no database and reads
 *   no clock: the "Open in Asana" link is a link, and a link that
 *   needed a request would be a request the token could ride on.
 *
 * The token never comes near this surface
 * ---------------------------------------
 * `buildAsanaTaskUrl` is a pure helper that takes the task gid and
 * NOTHING else — it has no token parameter, no credential parameter and
 * no access to the credentials context. The link it produces is a
 * public Asana web URL, so there is nothing in it for a token to hide
 * in (FR-010, FR-054, Principle IV). The gid is the only input, and
 * the helper is exported so its token-free shape is testable on its
 * own.
 *
 * Missing values
 * --------------
 * The surface keeps the states the domain keeps apart: a task with no
 * estimate is "Not estimated", a task whose time tracking Asana does
 * not expose is "Not available", and a task with no recorded time is
 * "Not recorded". A dash would have hidden the difference between "no
 * estimate" and "an estimate of zero minutes".
 *
 * Product voice
 * -------------
 * The copy names things the way a person would ("Apollo", "Not
 * completed", "Open in Asana"); the raw Asana ids stay in the values
 * and in the monospace elements the user needs to read them
 * (DESIGN.md › The Product Voice Rule, The Raw Means Raw Rule).
 *
 * Boundary
 * --------
 * `src/features/tasks/**` is the plan-documented home for the task-list
 * React UI. This module imports the cached `Task` shape (a type-only
 * import — no database, no Dexie at runtime), the domain's timezone
 * vocabulary and the shared formatters. It performs no I/O and makes no
 * network call.
 */
import type { ReactElement } from "react";

import type { Task } from "../../data/db/schema";
import type { TimezoneSetting } from "../../domain/types";
import { formatDate, formatDuration } from "../../shared/format";
import type { FilterOption } from "./FilterBar";

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The props `<TaskDetailDrawer />` consumes. Every field is `readonly`
 * and consumed via `Readonly<Props>` per the project-wide convention.
 */
export interface TaskDetailDrawerProps {
  /**
   * The task the drawer describes — the cached row, as-is. The cache
   * record already carries every project membership (FR-014, union-
   * resolved for subtasks) and the task's dependencies, so no adapter
   * layer sits between the cache and this surface.
   */
  readonly task: Task;
  /** The people, so an assignee `gid` can be shown by name. */
  readonly users: readonly FilterOption[];
  /** The projects, so a project `gid` can be shown by name. */
  readonly projects: readonly FilterOption[];
  /**
   * The tasks the drawer may name. A dependency is shown by name when
   * the caller's set knows it, and by its raw id when it does not — a
   * dependency the drawer cannot name is still a dependency, and
   * dropping it would read as "this task depends on nothing".
   */
  readonly tasks?: readonly Task[];
  /**
   * The human name of each priority option, keyed by the priority
   * option `gid`. Asana's priority option ids carry no readable name,
   * so without this map the surface shows the raw id.
   */
  readonly priorityLabels?: Readonly<Record<string, string>>;
  /**
   * The timezone basis the displayed dates are evaluated under
   * (FR-029/FR-030). Defaults to `"local"`, the app-wide default.
   */
  readonly timezone?: TimezoneSetting;
  /**
   * Called when the user dismisses the drawer. The caller owns the
   * open/closed state, so one source of truth stays in force
   * (DESIGN.md › The State Is One Source Rule). When it is absent the
   * drawer renders no close action rather than a dead button.
   */
  readonly onClose?: () => void;
}

/* -------------------------------------------------------------------------- */
/* Copy                                                                        */
/* -------------------------------------------------------------------------- */

/** The label of the drawer surface, for assistive technology. */
const DRAWER_LABEL = "Task detail";

/** The label of the task id row. */
const TASK_ID_LABEL = "Task id";

/** The label of the assignee row. */
const ASSIGNEE_LABEL = "Assignee";

/** The label of the priority row. */
const PRIORITY_LABEL = "Priority";

/** The label of the created-date row. */
const CREATED_LABEL = "Created";

/** The label of the due-date row. */
const DUE_LABEL = "Due";

/** The label of the completed-date row. */
const COMPLETED_LABEL = "Completed";

/** The label of the completion-state row. */
const STATUS_LABEL = "Status";

/** The label of the estimate row. */
const ESTIMATE_LABEL = "Estimate";

/** The label of the recorded-time row. */
const ACTUAL_LABEL = "Actual";

/** The heading of the project-memberships block. */
const PROJECTS_HEADING = "Projects";

/** The heading of the dependencies block. */
const DEPENDENCIES_HEADING = "Depends on";

/** The label of the close action. */
const CLOSE_LABEL = "Close";

/** The label of the link that opens the task in Asana. */
const OPEN_IN_ASANA_LABEL = "Open in Asana";

/** Shown for a task with no assignee. */
const UNASSIGNED_VALUE = "Unassigned";

/** Shown for a task with no priority. */
const NO_PRIORITY_VALUE = "No priority";

/** Shown for a task with no due date. */
const NO_DUE_DATE_VALUE = "No due date";

/** Shown for a task that has not been completed. */
const NOT_COMPLETED_VALUE = "Not completed";

/** Shown for a task that is complete. */
const COMPLETED_VALUE = "Complete";

/** Shown for a task that is still open. */
const INCOMPLETE_VALUE = "Incomplete";

/** Shown for a task with no estimate. */
const NOT_ESTIMATED_VALUE = "Not estimated";

/** Shown for a task with no recorded time. */
const NOT_RECORDED_VALUE = "Not recorded";

/** Shown when Asana does not expose time tracking for the task. */
const NOT_AVAILABLE_VALUE = "Not available";

/** Shown for a task that belongs to no project. */
const NO_PROJECTS_VALUE = "No projects";

/** Shown for a task that depends on nothing. */
const NO_DEPENDENCIES_VALUE = "No dependencies";

/* -------------------------------------------------------------------------- */
/* The Asana link                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The base of Asana's web app URLs. The API base
 * (`app.asana.com/api/1.0`) is deliberately NOT used here: the link is
 * a page a person reads, and a page never carries a credential.
 */
const ASANA_WEB_BASE = "https://app.asana.com/0";

/**
 * The workspace segment of an Asana permalink. Asana's task permalink
 * shape is `app.asana.com/0/<workspace>/<task>`; this builder is given
 * nothing but the task gid, so the workspace segment stays the literal
 * `0` placeholder rather than being filled from anywhere else. There is
 * no other input to fill it from — and no token to put there either.
 */
const ASANA_WORKSPACE_PLACEHOLDER = "0";

/**
 * Builds the Asana permalink for a task from its gid ALONE.
 *
 * This is the whole privacy story of the link, so it is deliberately a
 * pure function with a single parameter: it takes a gid, it returns a
 * URL, and it can never receive — let alone embed — the personal access
 * token (FR-010, FR-054, Constitution Principle IV). The gid is
 * percent-encoded so a hostile or malformed gid cannot smuggle a query
 * string into the URL.
 *
 * @param taskGid - The Asana gid of the task to open.
 * @returns The Asana web URL for that task.
 */
export function buildAsanaTaskUrl(taskGid: string): string {
  return `${ASANA_WEB_BASE}/${ASANA_WORKSPACE_PLACEHOLDER}/${encodeURIComponent(
    taskGid,
  )}`;
}

/* -------------------------------------------------------------------------- */
/* Value helpers                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Resolves a `gid` to a human name, falling back to the raw `gid` when
 * the option is not in the list the caller supplied. Showing the raw id
 * is honest — it names the thing — where inventing a name would not be.
 */
function nameFor(options: readonly FilterOption[], gid: string): string {
  return options.find((option) => option.gid === gid)?.name ?? gid;
}

/**
 * The priority of the task. The human name is used when the caller
 * supplied one; Asana's priority option ids carry no readable name, so
 * without a name the raw id is shown in monospace — an unreadable id is
 * still the truth about the task, where a made-up "High" would not be
 * (DESIGN.md › The Raw Means Raw Rule).
 */
function priorityCell(
  task: Task,
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
  return <code className="td-task-detail__priority-id">{optionId}</code>;
}

/** The estimate as a duration, or the "Not estimated" state. */
function estimateText(task: Task): string {
  return task.estimatedMinutes === null
    ? NOT_ESTIMATED_VALUE
    : formatDuration(task.estimatedMinutes);
}

/** The recorded time as a duration, or the state it is in. */
function actualText(task: Task): string {
  if (task.actualMinutes === "unavailable") {
    return NOT_AVAILABLE_VALUE;
  }
  if (task.actualMinutes === null) {
    return NOT_RECORDED_VALUE;
  }
  return formatDuration(task.actualMinutes);
}

/**
 * The name of a dependency, or its raw id when the caller's task set
 * does not know it. The unknown case is rendered in monospace because
 * an id IS a raw value (DESIGN.md › The Raw Means Raw Rule).
 */
function dependencyCell(gid: string, tasks: readonly Task[]): ReactElement {
  const name = tasks.find((candidate) => candidate.gid === gid)?.name;
  if (name === undefined) {
    return <code className="td-task-detail__dependency-id">{gid}</code>;
  }
  return <>{name}</>;
}

/* -------------------------------------------------------------------------- */
/* Component                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The detail of one task, reached by drilling into an aggregate
 * figure.
 *
 * The drawer shows EVERY project membership (FR-037) and EVERY
 * dependency (FR-053) — the drill-down exists so the user can check
 * the metric, and a detail that quietly showed one membership or one
 * dependency would fail that job while looking complete.
 */
export function TaskDetailDrawer({
  task,
  users,
  projects,
  tasks = [],
  priorityLabels = {},
  timezone = "local",
  onClose,
}: Readonly<TaskDetailDrawerProps>): ReactElement {
  return (
    <section
      className="td-task-detail"
      data-testid="task-detail-drawer"
      aria-label={DRAWER_LABEL}
    >
      <header className="td-task-detail__header">
        <h2 className="td-task-detail__name" data-testid="task-detail-name">
          {task.name}
        </h2>
        {onClose !== undefined ? (
          <button
            type="button"
            className="td-task-detail__close"
            data-testid="task-detail-close"
            onClick={onClose}
          >
            {CLOSE_LABEL}
          </button>
        ) : null}
      </header>

      <dl className="td-task-detail__fields">
        <dt>{TASK_ID_LABEL}</dt>
        <dd>
          <code
            className="td-task-detail__task-id"
            data-testid="task-detail-gid"
          >
            {task.gid}
          </code>
        </dd>
        <dt>{ASSIGNEE_LABEL}</dt>
        <dd data-testid="task-detail-assignee">
          {task.assigneeGid === null
            ? UNASSIGNED_VALUE
            : nameFor(users, task.assigneeGid)}
        </dd>
        <dt>{PRIORITY_LABEL}</dt>
        <dd data-testid="task-detail-priority">
          {priorityCell(task, priorityLabels)}
        </dd>
        <dt>{CREATED_LABEL}</dt>
        <dd data-testid="task-detail-created">
          {formatDate(task.createdAt, timezone)}
        </dd>
        <dt>{DUE_LABEL}</dt>
        <dd data-testid="task-detail-due">
          {task.dueAt === null
            ? NO_DUE_DATE_VALUE
            : formatDate(task.dueAt, timezone)}
        </dd>
        <dt>{COMPLETED_LABEL}</dt>
        <dd data-testid="task-detail-completed">
          {task.completedAt === null
            ? NOT_COMPLETED_VALUE
            : formatDate(task.completedAt, timezone)}
        </dd>
        <dt>{STATUS_LABEL}</dt>
        <dd data-testid="task-detail-status">
          {task.completedAt === null ? INCOMPLETE_VALUE : COMPLETED_VALUE}
        </dd>
        <dt>{ESTIMATE_LABEL}</dt>
        <dd data-testid="task-detail-estimate">{estimateText(task)}</dd>
        <dt>{ACTUAL_LABEL}</dt>
        <dd data-testid="task-detail-actual">{actualText(task)}</dd>
      </dl>

      <section
        className="td-task-detail__projects"
        aria-label={PROJECTS_HEADING}
      >
        <h3>{PROJECTS_HEADING}</h3>
        {task.projectGids.length === 0 ? (
          <p
            className="td-task-detail__empty"
            data-testid="task-detail-no-projects"
          >
            {NO_PROJECTS_VALUE}
          </p>
        ) : (
          <ul
            className="td-task-detail__project-list"
            data-testid="task-detail-projects"
          >
            {task.projectGids.map((gid) => (
              <li
                key={gid}
                className="td-task-detail__project"
                data-testid="task-detail-project"
                data-project-gid={gid}
              >
                {nameFor(projects, gid)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        className="td-task-detail__dependencies"
        aria-label={DEPENDENCIES_HEADING}
      >
        <h3>{DEPENDENCIES_HEADING}</h3>
        {task.dependsOnTaskGids.length === 0 ? (
          <p
            className="td-task-detail__empty"
            data-testid="task-detail-no-dependencies"
          >
            {NO_DEPENDENCIES_VALUE}
          </p>
        ) : (
          <ul
            className="td-task-detail__dependency-list"
            data-testid="task-detail-dependencies"
          >
            {task.dependsOnTaskGids.map((gid) => (
              <li
                key={gid}
                className="td-task-detail__dependency"
                data-testid="task-detail-dependency"
                data-dependency-gid={gid}
              >
                {dependencyCell(gid, tasks)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="td-task-detail__actions">
        <a
          className="td-task-detail__asana-link"
          data-testid="task-detail-asana-link"
          href={buildAsanaTaskUrl(task.gid)}
          target="_blank"
          rel="noreferrer noopener"
        >
          {OPEN_IN_ASANA_LABEL}
        </a>
      </p>
    </section>
  );
}
