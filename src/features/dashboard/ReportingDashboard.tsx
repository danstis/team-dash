/**
 * BSOD-781 (T-UI1) — `ReportingDashboard`, the live reporting surface
 * mounted at `/`.
 *
 * Spec / contract references
 * --------------------------
 * - FR-020: "the system MUST provide a prominent, explicit manual
 *   Refresh action; the system MUST NOT perform scheduled or
 *   background refreshes without user action."
 * - FR-021: on completion the system MUST show the outcome along with
 *   the last successful refresh timestamp and whether the data on
 *   screen is cached or fresh.
 * - FR-084: a visible summary of the data-completeness issues found
 *   during the most recent refresh.
 * - FR-085: the deliberately designed first-run / empty state, with a
 *   clear next action.
 * - FR-031–FR-042 (US3): a filterable task list whose tasks can be
 *   opened in their detail drawer.
 * - FR-043–FR-046, FR-056–FR-062 (US4): the work-added /
 *   work-completed metric, charted, switchable between the item-count
 *   and estimated-effort views, groupable, and drillable to the tasks
 *   behind every figure.
 * - Constitution Principle II (user-visible vertical slices): the
 *   components the earlier stages shipped must be present and operable
 *   in the live `/` route — not merely in their own component tests.
 * - Constitution Principle V (accessible, honest UX): semantic
 *   landmarks, a heading hierarchy that starts at the page's single
 *   `<h1>`, and a keyboard-reachable path to every drill-down.
 *
 * What this module owns
 * ---------------------
 * The reporting surface itself: the masthead, the decision about
 * which state the dashboard is in (first-run, empty, populated), the
 * metric's view/grouping state, and the two drill-down selections (a
 * task, and a chart figure).
 *
 * What this module deliberately does NOT own
 * ------------------------------------------
 * - The metric. `calculateWorkAddedVsCompleted` owns the bucketing,
 *   the deduplication and the drill-down sets; this surface maps its
 *   output onto the chart's `groups` prop and never counts a task of
 *   its own.
 * - The refresh itself. The refresh is driven by the shared
 *   `refreshOrchestrator` (the same one `RefreshControls` drives), so
 *   the fetch/stage/commit path exists once.
 * - The freshness label. `RefreshStatusPanel` owns the
 *   cached-versus-fresh decision (FR-021); this surface mounts it and
 *   leaves the decision to it.
 * - The filters. `TaskList` owns its filter criteria (they are its
 *   state, not the dashboard's), so the task table filters itself.
 *
 * ## How the dashboard reloads
 * ----------------------------
 * There is no `onRefreshComplete` callback to subscribe to: the
 * refresh-status surface resolves its own state, and the dashboard
 * needs the same data, so both read the same store. The dashboard
 * reads the local cache through Dexie's live queries
 * (`dexie-react-hooks`), which re-run whenever the tables they read
 * change. A refresh that commits therefore repopulates the dashboard
 * without a page reload and without a callback seam that the earlier
 * rows never built.
 *
 * The first-run state therefore needs no manual "reload" plumbing
 * either: the empty dashboard's Refresh action drives the shared
 * orchestrator, the commit writes the cache, and the live queries
 * re-run.
 *
 * ## The reporting period
 * ----------------------
 * The metric reports a period, so the dashboard owns one: the "last
 * 30 days" preset, resolved against the injected clock under the
 * app-wide timezone basis. The period is shown in the masthead, so a
 * screenshot of the dashboard states what it covers (DESIGN.md ›
 * Interaction & Copy › The Masthead Rule).
 *
 * The task list's own filters are separate: `TaskList` owns its
 * criteria, so the table can be narrowed independently of the metric.
 * Sharing one period between the chart and the table is a follow-up
 * that lifts the criteria into the dashboard.
 *
 * Determinism
 * -----------
 * The clock is read once per mount and injected into the metric
 * context and the task list, so the figures are reproducible from the
 * inputs rather than from the wall clock at render time. Every other
 * input is the local cache.
 *
 * Boundary
 * --------
 * `src/features/dashboard/**` is the plan-documented home for the
 * reporting-dashboard React UI. This module imports the feature
 * surfaces it composes, the shared repositories it reads, and the
 * domain metric it renders. It performs no Asana call of its own and
 * writes nothing to storage.
 */
import { useCallback, useMemo, useState, type ReactElement } from "react";
import { Link } from "react-router";
import { useLiveQuery } from "dexie-react-hooks";

import { useCredentialTokenAccessor } from "../../app/credentials-context";
import { useWorkspace } from "../../app/workspace-context";
import { cacheRepository } from "../../data/db/repositories/cache.repository";
import { refreshSessionRepository } from "../../data/db/repositories/refresh-session.repository";
import type {
  AsanaTeam,
  Portfolio,
  Project,
  RefreshSession,
  Task,
  User,
} from "../../data/db/schema";
import { refreshOrchestrator } from "../../data/refresh/refresh-orchestrator";
import {
  dateToIsoDateTime,
  resolveDateRangePreset,
} from "../../domain/datetime";
import {
  calculateWorkAddedVsCompleted,
  type WorkAddedCompletedSeries,
} from "../../domain/metrics/workAddedCompleted";
import type {
  DataQualityFlag,
  DateRange,
  DateRangePreset,
  FilterCriteria,
  MetricContext,
  MetricResult,
  TimezoneSetting,
} from "../../domain/types";
import { formatDate } from "../../shared/format";
import { useOnlineStatus } from "../../shared/hooks/useOnlineStatus";
import { LoadingState } from "../../shared/states/LoadingState";
import {
  CountEffortToggle,
  GroupBySelector,
  type ChartGroupBy,
  type ChartView,
} from "../metrics/ChartControls";
import {
  DrillDownPanel,
  type DrillDownFigure,
} from "../metrics/DrillDownPanel";
import {
  WorkAddedCompletedChart,
  type WorkAddedCompletedChartGroup,
  type WorkAddedCompletedDrillDownRequest,
} from "../metrics/WorkAddedCompletedChart";
import { DataQualitySummary } from "../refresh/DataQualitySummary";
import { EmptyDashboard } from "../refresh/EmptyDashboard";
import { OutcomeBanner, propsFromOutcome } from "../refresh/RefreshControls";
import { RefreshStatusPanel } from "../refresh/RefreshStatusPanel";
import type { FilterOption } from "../tasks/FilterBar";
import { TaskDetailDrawer } from "../tasks/TaskDetailDrawer";
import { TaskList } from "../tasks/TaskList";
import {
  buildGroupLabels,
  deriveDataQualityFlags,
  deriveTeamMapping,
  toMetricTasks,
} from "./dashboard-derivations";

/* -------------------------------------------------------------------------- */
/* Constants                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The reporting period the metric covers. FR-059 requires the metric to
 * report a period, and the dashboard owns the one its users see first;
 * the label is the same phrase the filter bar offers for the preset, so
 * the two surfaces name the same window the same way.
 */
const REPORTING_PRESET: DateRangePreset = "last_30_days";

/** The label of the reporting period, in the reader's words. */
const REPORTING_PERIOD_LABEL = "Last 30 days";

/**
 * The timezone basis every date the dashboard shows is evaluated under
 * (FR-029/FR-034). The app-wide default is the local basis; the
 * user-facing timezone toggle (a later row) changes this one value.
 */
const TIMEZONE: TimezoneSetting = "local";

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * What the drill-down panel is showing: either a figure of the
 * work-added / work-completed metric, or the data-completeness
 * findings of the most recent refresh.
 */
type PanelSelection =
  | {
      readonly kind: "metric";
      readonly request: WorkAddedCompletedDrillDownRequest;
    }
  | { readonly kind: "data_quality"; readonly flag: DataQualityFlag };

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The empty task list the live queries start from. Module-level
 * constants so the dashboard does not re-render on every pass with a
 * fresh array identity.
 */
const NO_TASKS: Task[] = [];
const NO_USERS: User[] = [];
const NO_PROJECTS: Project[] = [];
const NO_PORTFOLIOS: Portfolio[] = [];
const NO_TEAMS: AsanaTeam[] = [];
const NO_OVERRIDES: {
  projectGid: string;
  reportingTeamGid: string;
  updatedAt: string;
}[] = [];

/**
 * The label of a metric figure: what the reader clicked. The item-count
 * view and the estimated-effort view are two views of the same bucket
 * (FR-061), so the label names the view too.
 */
function measureLabel(request: WorkAddedCompletedDrillDownRequest): string {
  if (request.view === "count") {
    return request.measure === "created" ? "Items added" : "Items completed";
  }
  return request.measure === "created" ? "Effort added" : "Effort completed";
}

/**
 * The figure the metric displayed for the drilled bucket. The value is
 * the metric's own, so the drill-down panel can compare the list
 * against the figure the reader was shown (FR-062).
 */
function figureFor(
  request: WorkAddedCompletedDrillDownRequest,
  bucket:
    | {
        readonly createdCount: number;
        readonly completedCount: number;
        readonly createdEffortMinutes: number;
        readonly completedEffortMinutes: number;
      }
    | undefined,
): number {
  if (bucket === undefined) {
    return 0;
  }
  if (request.measure === "created") {
    return request.view === "count"
      ? bucket.createdCount
      : bucket.createdEffortMinutes;
  }
  return request.view === "count"
    ? bucket.completedCount
    : bucket.completedEffortMinutes;
}

/* -------------------------------------------------------------------------- */
/* Component                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The reporting dashboard: the live `/` surface.
 */
export function ReportingDashboard(): ReactElement {
  const workspace = useWorkspace();
  const workspaceGid = workspace.workspace?.gid ?? null;
  const tokenAccessor = useCredentialTokenAccessor();
  const isOnline = useOnlineStatus();

  /* ---------------------------------------------------------------- */
  /* The cached data                                                  */
  /* ---------------------------------------------------------------- */

  /**
   * The workspace's last successful refresh. `null` means the
   * workspace has never completed one — the first-run case.
   *
   * The live queries are read WITHOUT a default result on purpose: an
   * unresolved read must be distinguishable from an empty one, or the
   * dashboard would flash the first-run or empty state at a reader
   * whose data is merely still loading (FR-085's `'loading'` state).
   */
  const sessionResult = useLiveQuery(
    async (): Promise<RefreshSession | null> =>
      workspaceGid === null
        ? null
        : await refreshSessionRepository.getLastSuccessful(workspaceGid),
    [workspaceGid],
  );

  /** The tasks the workspace's active projects hold. */
  const taskResult = useLiveQuery(
    async (): Promise<Task[]> =>
      workspaceGid === null
        ? []
        : await cacheRepository.getInScopeTasks(workspaceGid),
    [workspaceGid],
  );

  /** The people of the workspace. */
  const userResult = useLiveQuery(
    async (): Promise<User[]> =>
      workspaceGid === null
        ? []
        : await cacheRepository.listUsers(workspaceGid),
    [workspaceGid],
  );

  /** The workspace's active projects. */
  const projectResult = useLiveQuery(
    async (): Promise<Project[]> =>
      workspaceGid === null
        ? []
        : await cacheRepository.listProjects(workspaceGid),
    [workspaceGid],
  );

  /** The workspace's portfolios. */
  const portfolioResult = useLiveQuery(
    async (): Promise<Portfolio[]> =>
      workspaceGid === null
        ? []
        : await cacheRepository.listPortfolios(workspaceGid),
    [workspaceGid],
  );

  /** The workspace's Asana teams. */
  const teamResult = useLiveQuery(
    async (): Promise<AsanaTeam[]> =>
      workspaceGid === null
        ? []
        : await cacheRepository.listAsanaTeams(workspaceGid),
    [workspaceGid],
  );

  /** The locally overridden project → reporting-team mappings. */
  const overrideResult = useLiveQuery(
    () => cacheRepository.listTeamMappingOverrides(),
    [],
  );

  /**
   * Whether the cached reads are still outstanding. The dashboard shows
   * the loading state until they are, so no reader ever sees an "empty"
   * report that is really a pending read.
   */
  const isLoading =
    sessionResult === undefined ||
    taskResult === undefined ||
    userResult === undefined ||
    projectResult === undefined ||
    portfolioResult === undefined ||
    teamResult === undefined ||
    overrideResult === undefined;

  const session = sessionResult ?? null;
  const tasks = taskResult ?? NO_TASKS;
  const users = userResult ?? NO_USERS;
  const projects = projectResult ?? NO_PROJECTS;
  const portfolios = portfolioResult ?? NO_PORTFOLIOS;
  const teams = teamResult ?? NO_TEAMS;
  const teamMappingOverrides = overrideResult ?? NO_OVERRIDES;

  const lastRefreshedAt = session?.finishedAt ?? null;
  const hasRefreshed = lastRefreshedAt !== null;

  /* ---------------------------------------------------------------- */
  /* The reporting context                                            */
  /* ---------------------------------------------------------------- */

  /**
   * The injected clock. Read once per mount so the metric's figures
   * are reproducible from their inputs rather than from the wall clock
   * at every render.
   */
  const now = useMemo(() => new Date(), []);

  /** The clock as the domain's instant. */
  const nowIso = useMemo(() => dateToIsoDateTime(now), [now]);

  /** The reporting period the metric buckets. */
  const dateRange = useMemo<DateRange>(() => {
    const { start, end } = resolveDateRangePreset(
      REPORTING_PRESET,
      now,
      TIMEZONE,
    );
    return { start, end, preset: REPORTING_PRESET };
  }, [now]);

  /**
   * The current project → reporting-team mapping (FR-044): the Asana
   * team that owns the project, unless the user has overridden it
   * locally. The metric resolves the reporting-team grouping through
   * this mapping, so the whole current mapping travels in the context.
   */
  const teamMapping = useMemo(
    () => deriveTeamMapping(projects, teamMappingOverrides, nowIso),
    [projects, teamMappingOverrides, nowIso],
  );

  /** The metric's shared context. */
  const metricContext = useMemo<MetricContext>(
    () => ({
      now: nowIso,
      timezone: TIMEZONE,
      weekStart: "monday",
      teamMapping,
    }),
    [nowIso, teamMapping],
  );

  /**
   * The cached tasks as the metric reads them: the cached row's own
   * fields, plus the portfolios its projects belong to (FR-040).
   */
  const metricTasks = useMemo(
    () => toMetricTasks(tasks, projects),
    [tasks, projects],
  );

  /* ---------------------------------------------------------------- */
  /* The metric                                                       */
  /* ---------------------------------------------------------------- */

  /** The people, as the filter surfaces offer them. */
  const userOptions = useMemo<FilterOption[]>(
    () => users.map((user) => ({ gid: user.gid, name: user.name })),
    [users],
  );

  /** The projects, as the filter surfaces offer them. */
  const projectOptions = useMemo<FilterOption[]>(
    () => projects.map((project) => ({ gid: project.gid, name: project.name })),
    [projects],
  );

  /** The chart's view: the item count or the estimated effort. */
  const [view, setView] = useState<ChartView>("count");

  /** The chart's grouping dimension; `undefined` is "no grouping". */
  const [groupBy, setGroupBy] = useState<ChartGroupBy | undefined>(undefined);

  /**
   * The metric's results, mapped onto the chart's `groups` shape: one
   * entry per group when the metric is grouped, a single
   * workspace-level entry when it is not.
   */
  const metricGroups = useMemo<WorkAddedCompletedChartGroup[]>(() => {
    const criteria: FilterCriteria = { dateRange };
    if (groupBy === undefined) {
      const result: MetricResult<WorkAddedCompletedSeries> =
        calculateWorkAddedVsCompleted(metricTasks, criteria, metricContext);
      return [{ groupKey: undefined, result }];
    }
    const grouped: Record<
      string,
      MetricResult<WorkAddedCompletedSeries>
    > = calculateWorkAddedVsCompleted(
      metricTasks,
      criteria,
      metricContext,
      groupBy,
    );
    return Object.entries(grouped).map(([groupKey, result]) => ({
      groupKey,
      result,
    }));
  }, [metricTasks, dateRange, metricContext, groupBy]);

  /** The human names of the groups the chart is split by. */
  const groupLabels = useMemo(
    () => buildGroupLabels(groupBy, users, projects, portfolios, teams),
    [groupBy, users, projects, portfolios, teams],
  );

  /* ---------------------------------------------------------------- */
  /* The drill-downs                                                  */
  /* ---------------------------------------------------------------- */

  /** The task the reader opened in the task table. */
  const [selectedTaskGid, setSelectedTaskGid] = useState<string | null>(null);

  /** What the drill-down panel is showing. */
  const [panelSelection, setPanelSelection] = useState<PanelSelection | null>(
    null,
  );

  /** The task the drawer describes. */
  const selectedTask = useMemo(
    () => tasks.find((task) => task.gid === selectedTaskGid) ?? null,
    [tasks, selectedTaskGid],
  );

  /** The figure the drill-down panel shows, and the list behind it. */
  const panel = useMemo<{
    readonly title: string;
    readonly figure: DrillDownFigure;
    readonly taskGids: readonly string[];
  } | null>(() => {
    if (panelSelection === null) {
      return null;
    }
    if (panelSelection.kind === "data_quality") {
      const { flag } = panelSelection;
      return {
        title: `Data completeness — ${flag.count} ${
          flag.count === 1 ? "task" : "tasks"
        }`,
        figure: {
          label: "Tasks with a data-completeness finding",
          value: flag.count,
          unit: "count",
        },
        taskGids: flag.taskGids,
      };
    }

    const request = panelSelection.request;
    const label = measureLabel(request);
    const group =
      metricGroups.find((entry) => entry.groupKey === request.groupKey) ??
      metricGroups[0];
    const bucket = group?.result.series.buckets.find(
      (candidate) => candidate.bucketStart === request.bucketStart,
    );
    return {
      title: `${label} — ${formatDate(request.bucketStart)}`,
      figure: {
        label,
        value: figureFor(request, bucket),
        unit: request.view === "count" ? "count" : "minutes",
      },
      taskGids: request.taskGids,
    };
  }, [panelSelection, metricGroups]);

  /* ---------------------------------------------------------------- */
  /* The data-completeness findings                                   */
  /* ---------------------------------------------------------------- */

  /**
   * The data-completeness findings of the most recent refresh, computed
   * from the cached tasks that refresh produced (FR-084). The full scan
   * (`calculateDataQuality`, a later row) replaces this; until then the
   * dashboard discloses the three gaps a cached task row can support.
   */
  const dataQualityFlags = useMemo(
    () => deriveDataQualityFlags(tasks),
    [tasks],
  );

  /* ---------------------------------------------------------------- */
  /* The refresh                                                      */
  /* ---------------------------------------------------------------- */

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshOutcome, setRefreshOutcome] = useState<ReturnType<
    typeof propsFromOutcome
  > | null>(null);

  /**
   * The empty dashboard's Refresh action (FR-020). It drives the same
   * orchestrator the refresh-status surface drives, so the fetch /
   * stage / commit path exists once, and the cache the dashboard reads
   * is the cache the refresh wrote.
   */
  const runRefresh = useCallback((): void => {
    const token = tokenAccessor.getPlaintextToken();
    const gid = workspace.workspace?.gid;
    if (token === null || gid === undefined) {
      return;
    }
    setIsRefreshing(true);
    setRefreshOutcome(null);
    void (async (): Promise<void> => {
      try {
        const outcome = await refreshOrchestrator.runRefresh({
          workspaceGid: gid,
          token,
        });
        setRefreshOutcome(propsFromOutcome(outcome));
      } catch {
        // The orchestrator turns every documented failure into an
        // outcome; a throw here is an orchestrator-level defect rather
        // than a refresh failure mode. The raw message is deliberately
        // not surfaced — it could echo the token (FR-008, FR-010).
        setRefreshOutcome({
          kind: "partial_failure",
          state: "failed",
          completedAt: null,
          reason: "network_error",
          message: "The refresh did not finish. Nothing on screen changed.",
          cacheIntact: true,
        });
      } finally {
        setIsRefreshing(false);
      }
    })();
  }, [tokenAccessor, workspace.workspace]);

  /* ---------------------------------------------------------------- */
  /* The masthead                                                     */
  /* ---------------------------------------------------------------- */

  const scopeLabel = `${projects.length} ${
    projects.length === 1 ? "project" : "projects"
  }`;
  const scopeSummary = `${workspace.workspace?.name ?? "No workspace"} · ${scopeLabel} · ${REPORTING_PERIOD_LABEL}`;

  /* ---------------------------------------------------------------- */
  /* The surface                                                      */
  /* ---------------------------------------------------------------- */

  return (
    <main className="team-dash-shell" lang="en-AU">
      <header className="td-dashboard__masthead">
        <div className="td-dashboard__identity">
          <h1>Team Dash</h1>
          <p className="td-dashboard__scope" data-testid="dashboard-scope">
            {scopeSummary}
          </p>
        </div>
        <nav className="td-dashboard__actions" aria-label="Dashboard">
          <Link to="/settings" data-testid="nav-settings">
            Settings
          </Link>
        </nav>
        <div className="td-dashboard__freshness">
          <RefreshStatusPanel />
        </div>
      </header>

      {isLoading && <LoadingState data-testid="dashboard-loading" />}
      {!isLoading && hasRefreshed && (
        <>
          <DataQualitySummary
            flags={dataQualityFlags}
            onSelectFlag={(flag): void => {
              setPanelSelection({ kind: "data_quality", flag });
            }}
          />

          <CountEffortToggle value={view} onChange={setView} />
          <GroupBySelector value={groupBy} onChange={setGroupBy} />

          <WorkAddedCompletedChart
            groups={metricGroups}
            view={view}
            groupBy={groupBy}
            groupLabels={groupLabels}
            onDrillDown={(request): void => {
              setPanelSelection({ kind: "metric", request });
            }}
          />

          {metricTasks.length === 0 ? (
            <EmptyDashboard
              state="empty"
              onRefresh={runRefresh}
              disabled={!isOnline}
              busy={isRefreshing}
            />
          ) : (
            <TaskList
              tasks={metricTasks}
              users={userOptions}
              projects={projectOptions}
              now={now}
              timezone={TIMEZONE}
              onSelectTask={(taskGid): void => {
                setSelectedTaskGid(taskGid);
              }}
            />
          )}

          {selectedTask !== null ? (
            <TaskDetailDrawer
              task={selectedTask}
              users={userOptions}
              projects={projectOptions}
              tasks={tasks}
              timezone={TIMEZONE}
              onClose={() => {
                setSelectedTaskGid(null);
              }}
            />
          ) : null}

          {panel !== null ? (
            <DrillDownPanel
              title={panel.title}
              figure={panel.figure}
              taskGids={panel.taskGids}
              tasks={tasks}
              users={userOptions}
              projects={projectOptions}
              timezone={TIMEZONE}
            />
          ) : null}
        </>
      )}
      {!isLoading && !hasRefreshed && (
        <EmptyDashboard
          state="first_run"
          onRefresh={runRefresh}
          disabled={!isOnline}
          busy={isRefreshing}
        />
      )}
      {refreshOutcome !== null ? <OutcomeBanner {...refreshOutcome} /> : null}
    </main>
  );
}
