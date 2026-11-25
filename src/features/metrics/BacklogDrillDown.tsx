/**
 * BSOD-324 (T087) — `BacklogDrillDown`, the US5 backlog drill-down.
 *
 * Spec / contract references
 * --------------------------
 * - FR-067 (spec.md): "The system MUST make each backlog figure
 *   drillable to its exact contributing incomplete-task list, including
 *   historical points where the drill-down reflects tasks currently
 *   known to have been incomplete on that date." This module IS that
 *   drill-down for the backlog.
 * - FR-063 (spec.md): the current backlog is a point-in-time state, so
 *   its drill-down lists the tasks that are incomplete TODAY — not the
 *   activity of the selected period.
 * - FR-064 (spec.md): the history is reconstructed from the tasks' own
 *   creation / completion dates, so a historical point's drill-down
 *   lists the tasks that were incomplete on THAT date.
 * - FR-066 (spec.md): a historical effort figure uses each task's
 *   CURRENT cached estimate applied retroactively, and the system MUST
 *   disclose that limitation — Asana does not expose historical
 *   estimate values.
 * - FR-058 (spec.md): the tasks left out of an effort sum are disclosed
 *   rather than silently dropped.
 * - FR-037 (spec.md): a drill-down shows ALL of a task's project
 *   memberships.
 * - Constitution Principle VII (Honest UX — drill parity): the surface
 *   shows the figure the user clicked AND the tasks behind it, and it
 *   never claims a match it has not checked.
 *
 * What this module owns
 * ---------------------
 * The mapping from a drilled backlog figure to the exact contributing
 * incomplete-task list: which reconstructed date the figure belongs to,
 * which figure of that date was clicked (the item count or the
 * estimated effort), the metric's own drill-down set for that date,
 * and the retroactive-estimate disclosure a historical effort figure
 * carries.
 *
 * What this module deliberately does NOT own
 * ------------------------------------------
 * - The metric. `calculateBacklogCurrent` and `calculateBacklogDirection`
 *   (T082 / BSOD-322) own the reconstruction predicate, the figures
 *   and the drill-down sets. This module reads them; it never recounts
 *   a task, so the list and the figure cannot drift apart.
 * - The drill-down surface itself. `DrillDownPanel` (T081 / BSOD-321)
 *   renders the list and the task detail; this module composes it.
 * - The chart. The backlog view (T083 / BSOD-325) draws the trend and
 *   owns the state of which figure is open; this module renders the
 *   drill-down for the figure it is handed.
 * - Any I/O. The surface renders the tasks it is handed; the caller
 *   owns the cache read.
 *
 * The drill-down key
 * ------------------
 * The backlog metric keys its drill-down sets by `incomplete:<date>`
 * (FR-067) — one entry per reconstructed day — and keeps that key
 * builder private to the domain. This module composes the same key,
 * because the key is the only handle the metric's result offers on its
 * per-date sets. The format is stated here in one place, next to the
 * metric it belongs to, so a change to the key is a one-line change
 * in each of the two places that name it.
 *
 * Boundary
 * --------
 * `src/features/metrics/**` is the plan-documented home for the
 * metrics React UI. This module imports the domain's metric types, the
 * domain's date vocabulary and the shared drill-down panel. It
 * performs no I/O and makes no network call.
 */
import type { ReactElement } from "react";

import type { Task } from "../../data/db/schema";
import { isoDateTimeToDate, toIsoDate } from "../../domain/datetime";
import {
  BACKLOG_RETROACTIVE_ESTIMATE_DISCLOSURE,
  type BacklogCurrentValue,
  type BacklogPointSeries,
} from "../../domain/metrics/backlog";
import type {
  ContributingTaskGids,
  ISODate,
  MetricResult,
  TimezoneSetting,
} from "../../domain/types";
import { formatDate } from "../../shared/format";
import type { FilterOption } from "../tasks/FilterBar";
import {
  DrillDownPanel,
  type DrillDownFigure,
  type DrillDownFigureUnit,
} from "./DrillDownPanel";

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Which of the two figures of a backlog date the user drilled into: the
 * number of incomplete tasks, or their estimated effort. The two are
 * separate views of the same list, never one blended number (FR-061's
 * principle, applied to the backlog).
 */
export type BacklogDrillDownView = "count" | "effort";

/**
 * The backlog figure the user drilled into.
 *
 * The current state and a reconstructed point are different figures
 * with different sources — today's state comes from the current
 * calculator, a historical point from the reconstructed series — so
 * the surface is told which one it is rendering rather than guessing.
 */
export type BacklogDrillDownFigure =
  | {
      /** The current backlog state (FR-063). */
      readonly kind: "current";
      /** Which of the state's two figures was drilled into. */
      readonly view: BacklogDrillDownView;
    }
  | {
      /** A reconstructed point of the backlog series (FR-064). */
      readonly kind: "historical";
      /** Which of the point's two figures was drilled into. */
      readonly view: BacklogDrillDownView;
      /** The calendar date the point reconstructs. */
      readonly date: ISODate;
    };

/**
 * The props `<BacklogDrillDown />` consumes. Every field is `readonly`
 * and consumed via `Readonly<Props>` per the project-wide convention.
 */
export interface BacklogDrillDownProps {
  /**
   * The backlog figure the user drilled into — the current state or a
   * reconstructed point, and which of its two figures.
   */
  readonly figure: BacklogDrillDownFigure;
  /**
   * The current backlog state (FR-063). It carries today's figures and
   * today's drill-down set; it is read for a current figure.
   */
  readonly current: MetricResult<BacklogCurrentValue>;
  /**
   * The reconstructed backlog series (FR-064). It carries every
   * point's figures and every point's drill-down set (FR-067); it is
   * read for a historical figure.
   */
  readonly series: MetricResult<BacklogPointSeries>;
  /**
   * The cached task rows the contributing gids are resolved against.
   * The whole set is handed on, so the drawer can name a task's
   * dependencies.
   */
  readonly tasks: readonly Task[];
  /** The people, so an assignee `gid` can be shown by name. */
  readonly users: readonly FilterOption[];
  /** The projects, so a project `gid` can be shown by name. */
  readonly projects: readonly FilterOption[];
  /**
   * The human name of each priority option, keyed by the priority
   * option `gid`.
   */
  readonly priorityLabels?: Readonly<Record<string, string>>;
  /**
   * The timezone basis the dates are evaluated under (FR-029/FR-030).
   * Defaults to `"local"`, the app-wide default.
   */
  readonly timezone?: TimezoneSetting;
  /** Dismiss the drill-down when the caller supports closing it. */
  readonly onClose?: () => void;
}

/* -------------------------------------------------------------------------- */
/* Constants                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The prefix of the metric's drill-down key (FR-067). The backlog
 * metric keys its per-date sets by `incomplete:<date>`; the domain
 * keeps its key builder private, so the format is named here as well.
 */
const DRILL_DOWN_KEY_PREFIX = "incomplete";

/** The label of the item-count figure of a backlog date. */
const COUNT_LABEL = "Incomplete tasks";

/** The label of the estimated-effort figure of a backlog date. */
const EFFORT_LABEL = "Incomplete estimated effort";

/**
 * What the surface says when the drilled date is not part of the
 * reconstructed series. It says so rather than showing an empty list
 * against a figure it never had (Principle VII).
 */
const UNAVAILABLE_MESSAGE =
  "That date is not part of the reconstructed backlog, so it has no tasks to show.";

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The drill-down key of one date (FR-067): the figure name and the
 * date it reconstructs.
 */
function drillDownKey(date: ISODate): string {
  return `${DRILL_DOWN_KEY_PREFIX}:${date}`;
}

/**
 * The contributing task gids of one date, out of a metric result's
 * drill-down map.
 *
 * The backlog metric reports one set per date, so it uses the map form
 * of the drill-down channel. A flat list cannot say which date a task
 * belongs to, and a surface that guessed would attribute tasks to the
 * wrong day — so a result without the map form yields no tasks rather
 * than an arbitrary list.
 */
function gidsFor(
  contributing: ContributingTaskGids,
  date: ISODate,
): readonly string[] {
  if (Array.isArray(contributing)) {
    return [];
  }
  return contributing[drillDownKey(date)] ?? [];
}

/**
 * Today's date in the reporting timezone basis: the calendar day the
 * metric's clock falls on. The clock arrives through the metric
 * result, so this surface reads no wall clock (Principle VI).
 */
function todayOf(
  current: MetricResult<BacklogCurrentValue>,
  timezone: TimezoneSetting,
): ISODate {
  return toIsoDate(isoDateTimeToDate(current.asOf), timezone);
}

/**
 * The unit of a backlog figure: an item count, or estimated effort in
 * minutes. The two are never blended.
 */
function drillDownUnit(view: BacklogDrillDownView): DrillDownFigureUnit {
  return view === "count" ? "count" : "minutes";
}

/**
 * A drilled backlog figure, resolved: the date it reconstructs, its two
 * figures and the exact contributing task set behind them.
 */
interface ResolvedFigure {
  /** The calendar date the figure reconstructs. */
  readonly date: ISODate;
  /** How many tasks were incomplete on that date (FR-063/FR-064). */
  readonly count: number;
  /** The summed estimate of those tasks, in minutes. */
  readonly effortMinutes: number;
  /** The gids of those tasks, in the metric's own order (FR-067). */
  readonly gids: readonly string[];
}

/**
 * Resolves the CURRENT backlog state (FR-063): today's figures and
 * today's incomplete tasks.
 */
function resolveCurrent(
  current: MetricResult<BacklogCurrentValue>,
  date: ISODate,
): ResolvedFigure {
  return {
    date,
    count: current.series.incompleteCount,
    effortMinutes: current.series.incompleteEffortMinutes,
    gids: gidsFor(current.contributingTaskGids, date),
  };
}

/**
 * Resolves a RECONSTRUCTED point of the backlog series (FR-064): the
 * point's figures and the tasks that were incomplete on that date.
 *
 * A date the series does not reconstruct has no point and no task set,
 * so it resolves to `null` — the surface says so rather than showing an
 * empty list against a figure it never had.
 */
function resolveHistorical(
  series: MetricResult<BacklogPointSeries>,
  date: ISODate,
): ResolvedFigure | null {
  const point = series.series.points.find(
    (candidate) => candidate.date === date,
  );
  if (point === undefined) {
    return null;
  }
  return {
    date,
    count: point.incompleteCount,
    effortMinutes: point.incompleteEffortMinutes,
    gids: gidsFor(series.contributingTaskGids, date),
  };
}

/* -------------------------------------------------------------------------- */
/* Component                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The backlog drill-down: the backlog figure the user drilled into and
 * the exact incomplete tasks behind it, with the shared task detail
 * drawer one click away.
 */
export function BacklogDrillDown({
  figure,
  current,
  series,
  tasks,
  users,
  projects,
  priorityLabels = {},
  timezone = "local",
  onClose,
}: Readonly<BacklogDrillDownProps>): ReactElement {
  const historical = figure.kind === "historical";

  const date =
    figure.kind === "historical" ? figure.date : todayOf(current, timezone);

  const title = historical
    ? `Backlog on ${formatDate(date)}`
    : `Backlog today — ${formatDate(date)}`;

  const resolved = historical
    ? resolveHistorical(series, date)
    : resolveCurrent(current, date);

  // A date the series does not reconstruct has no figure and no task
  // set; the surface says so instead of showing an empty list against a
  // figure it never had.
  if (resolved === null) {
    return (
      <section
        className="td-backlog-drill-down"
        data-testid="backlog-drill-down"
        aria-label={title}
      >
        <h2 className="td-drill-down-panel__heading">{title}</h2>
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
          className="td-backlog-drill-down__unavailable"
          data-testid="backlog-drill-down-unavailable"
        >
          {UNAVAILABLE_MESSAGE}
        </p>
      </section>
    );
  }

  const drillDownFigure: DrillDownFigure = {
    label: figure.view === "count" ? COUNT_LABEL : EFFORT_LABEL,
    value: figure.view === "count" ? resolved.count : resolved.effortMinutes,
    unit: drillDownUnit(figure.view),
  };

  return (
    <section
      className="td-backlog-drill-down"
      data-testid="backlog-drill-down"
      aria-label={title}
    >
      {/* FR-066 — a historical effort figure uses each task's CURRENT
          estimate, applied to the days the task was incomplete, and the
          reader is told so. The count view shows no effort figure, so
          the disclosure belongs to the effort view. */}
      {historical && figure.view === "effort" ? (
        <p
          className="td-backlog-drill-down__disclosure"
          data-testid="backlog-drill-down-disclosure"
        >
          {BACKLOG_RETROACTIVE_ESTIMATE_DISCLOSURE}
        </p>
      ) : null}

      <DrillDownPanel
        title={title}
        figure={drillDownFigure}
        taskGids={resolved.gids}
        tasks={tasks}
        users={users}
        projects={projects}
        priorityLabels={priorityLabels}
        timezone={timezone}
        onClose={onClose}
      />
    </section>
  );
}
