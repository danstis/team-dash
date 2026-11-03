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
  /**
   * The caller's filters. When given, the list is controlled: it renders
   * no filter surface of its own, and `tasks` is expected to be already
   * narrowed to the caller's date window, so the date range is not
   * applied again here (it would match on due date, not the window's
   * created/completed basis). `onClearAll` clears the caller's filters.
   */
  readonly criteria?: FilterCriteria;
  readonly onClearAll?: () => void;
}

export function TaskList({
  tasks,
  users,
  projects,
  priorityLabels,
  now,
  timezone = "local",
  onSelectTask,
  criteria: controlledCriteria,
  onClearAll,
}: Readonly<TaskListProps>): ReactElement {
  const [ownCriteria, setOwnCriteria] = useState<FilterCriteria>({});
  const controlled = controlledCriteria !== undefined;
  const criteria = controlledCriteria ?? ownCriteria;
  const clearAll = controlled
    ? (onClearAll ?? ((): void => undefined))
    : () => setOwnCriteria({});
  // A controlled list's date window is applied by the caller.
  const tableCriteria: FilterCriteria = controlled
    ? { ...criteria, dateRange: undefined }
    : criteria;
  const instant = dateToIsoDateTime(now);
  const filteredTasks = filterTasks(tasks, tableCriteria, {
    timezone,
    now: instant,
  });
  const showNoResults =
    tasks.length > 0 &&
    filteredTasks.length === 0 &&
    hasActiveFilters(tableCriteria);

  return (
    <>
      {controlled ? null : (
        <FilterBar
          criteria={criteria}
          onChange={setOwnCriteria}
          users={users}
          projects={projects}
          now={now}
          timezone={timezone}
        />
      )}
      {showNoResults ? (
        <NoResultsState
          criteria={tableCriteria}
          users={users}
          projects={projects}
          onClearAll={clearAll}
          timezone={timezone}
        />
      ) : (
        <>
          {controlled ? null : (
            <ActiveFiltersList
              criteria={criteria}
              users={users}
              projects={projects}
              onClearAll={clearAll}
              timezone={timezone}
            />
          )}
          <TaskTable
            tasks={tasks}
            criteria={tableCriteria}
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
