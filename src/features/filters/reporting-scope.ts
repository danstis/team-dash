/**
 * Which tasks the report's date window keeps.
 *
 * The chart counts work by when it was created and when it was
 * completed, so the window matches on those two times and nothing else:
 * a task is in the window when it was created in it or completed in it.
 * Due dates play no part, which is what lets the task table reconcile
 * with the chart's figures.
 *
 * The predicates are the domain's own (`matchesDateRange` and
 * `orPredicates`); this module only chooses the two bases.
 */
import {
  filterTasks,
  matchesDateRange,
  orPredicates,
  type FilterableTask,
} from "../../domain/filtering/filters";
import type {
  FilterCriteria,
  ISODateTime,
  TimezoneSetting,
} from "../../domain/types";

/**
 * The tasks the criteria keep: created or completed inside the window,
 * and every other active filter. The input is never mutated.
 */
export function filterTasksForReport<T extends FilterableTask>(
  tasks: readonly T[],
  criteria: FilterCriteria,
  options: { readonly timezone: TimezoneSetting; readonly now: ISODateTime },
): T[] {
  const range = criteria.dateRange;
  const others = filterTasks(
    tasks,
    { ...criteria, dateRange: undefined },
    options,
  );
  if (range === undefined) {
    return others;
  }
  const inWindow = orPredicates(
    matchesDateRange(range, { basis: "created", timezone: options.timezone }),
    matchesDateRange(range, {
      basis: "completed",
      timezone: options.timezone,
    }),
  );
  return others.filter((task) => inWindow(task));
}
