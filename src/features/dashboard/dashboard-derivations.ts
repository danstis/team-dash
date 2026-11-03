import type {
  Project,
  Task,
  User,
  Portfolio,
  AsanaTeam,
  TeamMappingOverride as StoredTeamMappingOverride,
} from "../../data/db/schema";
import { isoDateTimeToDate, toIsoDate } from "../../domain/datetime";
import type {
  DataQualityFlag,
  ISODate,
  ISODateTime,
  TeamMappingOverride,
  TimezoneSetting,
} from "../../domain/types";
import type { ChartGroupBy } from "../metrics/ChartControls";
import type { TaskTableTask } from "../tasks/TaskTable";

export interface DashboardTaskRow extends TaskTableTask {
  readonly portfolioGids: readonly string[];
}

export function deriveTeamMapping(
  projects: readonly Project[],
  overrides: readonly StoredTeamMappingOverride[],
  now: ISODateTime,
): TeamMappingOverride[] {
  const overrideByProject = new Map(
    overrides.map((override) => [override.projectGid, override]),
  );
  const mapping: TeamMappingOverride[] = [];
  for (const project of projects) {
    const override = overrideByProject.get(project.gid);
    const reportingTeamGid = override?.reportingTeamGid ?? project.asanaTeamGid;
    if (reportingTeamGid === null) continue;
    mapping.push({
      projectGid: project.gid,
      reportingTeamGid,
      updatedAt: (override?.updatedAt ?? now) as ISODateTime,
    });
  }
  return mapping;
}

export function toMetricTasks(
  tasks: readonly Task[],
  projects: readonly Project[],
): DashboardTaskRow[] {
  const portfoliosByProject = new Map(
    projects.map((project) => [project.gid, project.portfolioGids]),
  );
  return tasks.map((task) => ({
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
    portfolioGids: [
      ...new Set(
        task.projectGids.flatMap((gid) => portfoliosByProject.get(gid) ?? []),
      ),
    ],
  }));
}

export function buildGroupLabels(
  groupBy: ChartGroupBy | undefined,
  users: readonly User[],
  projects: readonly Project[],
  portfolios: readonly Portfolio[],
  teams: readonly AsanaTeam[],
): Record<string, string> {
  switch (groupBy) {
    case "assignee":
      return Object.fromEntries(users.map(({ gid, name }) => [gid, name]));
    case "project":
      return Object.fromEntries(projects.map(({ gid, name }) => [gid, name]));
    case "portfolio":
      return Object.fromEntries(portfolios.map(({ gid, name }) => [gid, name]));
    case "reportingTeam":
      return Object.fromEntries(teams.map(({ gid, name }) => [gid, name]));
    case "priority":
    default:
      return {};
  }
}

/**
 * The earliest calendar date any activity in the cache falls on — the
 * oldest task creation or the oldest completion, whichever is earlier.
 *
 * The all-time reporting period opens here (FR-091): an open-ended
 * range would otherwise mean walking a thousand years of weekly
 * buckets, while the data only reaches back as far as its oldest
 * activity. `undefined` when the cache holds no dated task at all.
 */
export function earliestActivityDate(
  tasks: readonly DashboardTaskRow[],
  timezone: TimezoneSetting,
): ISODate | undefined {
  let earliest: ISODate | undefined;
  for (const task of tasks) {
    for (const instant of [task.createdAt, task.completedAt]) {
      if (instant === null) {
        continue;
      }
      const date = toIsoDate(isoDateTimeToDate(instant), timezone);
      if (earliest === undefined || date < earliest) {
        earliest = date;
      }
    }
  }
  return earliest;
}

export function deriveDataQualityFlags(
  tasks: readonly Task[],
): DataQualityFlag[] {
  const gaps = [
    {
      kind: "missing_assignee" as const,
      taskGids: tasks
        .filter((task) => task.assigneeGid === null)
        .map((task) => task.gid),
    },
    {
      kind: "missing_estimate" as const,
      taskGids: tasks
        .filter((task) => task.estimatedMinutes === null)
        .map((task) => task.gid),
    },
    {
      kind: "missing_priority" as const,
      taskGids: tasks
        .filter((task) => task.priorityOptionId === null)
        .map((task) => task.gid),
    },
  ];
  return gaps.map(({ kind, taskGids }) => ({
    kind,
    taskGids,
    count: taskGids.length,
  }));
}
