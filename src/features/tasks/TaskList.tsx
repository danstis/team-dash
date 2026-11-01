/** The task-list composition: one filter state drives the bar, active-filter
 * summary, table, and zero-match message. */
import { useState, type ReactElement } from "react";

import { dateToIsoDateTime } from "../../domain/datetime";
import { filterTasks, hasActiveFilters } from "../../domain/filtering/filters";
import type { FilterCriteria, TimezoneSetting } from "../../domain/types";
import { ActiveFiltersList } from "./ActiveFiltersList";
import { FilterBar, type FilterOption } from "./FilterBar";
import { NoResultsState } from "./NoResultsState";
import { TaskTable, type TaskTableTask } from "./TaskTable";

export interface TaskListProps {
  readonly tasks: readonly TaskTableTask[];
  readonly users: readonly FilterOption[];
  readonly projects: readonly FilterOption[];
  readonly priorityLabels?: Readonly<Record<string, string>>;
  readonly now: Date;
  readonly timezone?: TimezoneSetting;
  /**
   * Called with the `gid` of the task the reader activated in the
   * table. The list owns no drill-down state of its own — the caller
   * decides which task is open and mounts the detail surface for it.
   */
  readonly onSelectTask?: (taskGid: string) => void;
}

export function TaskList({
  tasks,
  users,
  projects,
  priorityLabels,
  now,
  timezone = "local",
  onSelectTask,
}: Readonly<TaskListProps>): ReactElement {
  const [criteria, setCriteria] = useState<FilterCriteria>({});
  const clearAll = (): void => setCriteria({});
  const instant = dateToIsoDateTime(now);
  const filteredTasks = filterTasks(tasks, criteria, {
    timezone,
    now: instant,
  });
  const showNoResults =
    tasks.length > 0 &&
    filteredTasks.length === 0 &&
    hasActiveFilters(criteria);

  return (
    <>
      <FilterBar
        criteria={criteria}
        onChange={setCriteria}
        users={users}
        projects={projects}
        now={now}
        timezone={timezone}
      />
      {showNoResults ? (
        <NoResultsState
          criteria={criteria}
          users={users}
          projects={projects}
          onClearAll={clearAll}
          timezone={timezone}
        />
      ) : (
        <>
          <ActiveFiltersList
            criteria={criteria}
            users={users}
            projects={projects}
            onClearAll={clearAll}
            timezone={timezone}
          />
          <TaskTable
            tasks={tasks}
            criteria={criteria}
            users={users}
            projects={projects}
            priorityLabels={priorityLabels}
            timezone={timezone}
            now={instant}
            onSelectTask={onSelectTask}
          />
        </>
      )}
    </>
  );
}
