/**
 * The reporting filter model: which filters the pill bar offers, how each
 * one reads in its pill, and how a pill is added to or removed from a
 * `FilterCriteria`.
 *
 * The model is pure. The predicates that decide which tasks a criteria
 * keeps stay in `src/domain/filtering/filters.ts`; this module only
 * describes and edits the selection, so the bar and the domain cannot
 * disagree about what a filter means.
 *
 * Product voice: pills read the way a person would say them ("Person:
 * Ana, Ben", "Completion: Incomplete"); raw criteria literals such as
 * `"no_priority"` never reach the text.
 */
import type {
  DateRangePreset,
  FilterCriteria,
  TimezoneSetting,
} from "../../domain/types";
import { formatDate } from "../../shared/format";

/** One thing a filter pill can narrow the report by. */
export type FilterKind =
  | "dateRange"
  | "person"
  | "project"
  | "completion"
  | "priority"
  | "estimate"
  | "overdue";

/** The kinds in the order the menu and the pills list them. */
export const FILTER_KINDS: readonly FilterKind[] = [
  "dateRange",
  "person",
  "project",
  "completion",
  "priority",
  "estimate",
  "overdue",
];

/** The name each kind goes by, in its pill and in the add-filter menu. */
export const FILTER_LABELS: Readonly<Record<FilterKind, string>> = {
  dateRange: "Date range",
  person: "Person",
  project: "Project",
  completion: "Completion",
  priority: "Priority",
  estimate: "Estimate",
  overdue: "Overdue",
};

/** The reporting window is always present: its pill has no remove button. */
export function isRemovable(kind: FilterKind): boolean {
  return kind !== "dateRange";
}

/** The label of each date-range preset, in the reader's words. */
export const PRESET_LABELS: Readonly<Record<DateRangePreset, string>> = {
  this_week: "This week",
  last_week: "Last week",
  last_30_days: "Last 30 days",
  this_month: "This month",
  last_month: "Last month",
  this_quarter: "This quarter",
};

/** A person or project the value editors can offer. */
export interface FilterValueOption {
  readonly gid: string;
  readonly name: string;
}

/** The single-choice options of the kinds that take one value. */
export const SINGLE_CHOICES: Readonly<
  Partial<Record<FilterKind, readonly { value: string; label: string }[]>>
> = {
  completion: [
    { value: "incomplete", label: "Incomplete" },
    { value: "complete", label: "Complete" },
  ],
  priority: [{ value: "no_priority", label: "Missing" }],
  estimate: [
    { value: "estimated", label: "Estimated" },
    { value: "unestimated", label: "Not estimated" },
  ],
  overdue: [
    { value: "overdue", label: "Overdue" },
    { value: "on_time", label: "On time" },
    { value: "no_due_date", label: "No due date" },
  ],
};

/** Whether the criteria carry a selection for this kind. */
export function isKindActive(
  criteria: FilterCriteria,
  kind: FilterKind,
): boolean {
  switch (kind) {
    case "dateRange":
      return criteria.dateRange !== undefined;
    case "person":
      return (
        criteria.assigneeGids === "unassigned" ||
        (Array.isArray(criteria.assigneeGids) &&
          criteria.assigneeGids.length > 0)
      );
    case "project":
      return (criteria.projectGids ?? []).length > 0;
    case "completion":
      return (criteria.completionState ?? null) !== null;
    case "priority":
      return (
        criteria.priorityOptionIds === "no_priority" ||
        (Array.isArray(criteria.priorityOptionIds) &&
          criteria.priorityOptionIds.length > 0)
      );
    case "estimate":
      return (criteria.estimateState ?? null) !== null;
    case "overdue":
      return (criteria.overdueState ?? null) !== null;
  }
}

/** The kinds that currently have a pill, in menu order. */
export function activeKinds(criteria: FilterCriteria): FilterKind[] {
  return FILTER_KINDS.filter((kind) => isKindActive(criteria, kind));
}

/** The kinds the add-filter menu still offers: every kind not yet in use. */
export function availableKinds(criteria: FilterCriteria): FilterKind[] {
  return FILTER_KINDS.filter((kind) => !isKindActive(criteria, kind));
}

/** The criteria with one kind's selection removed. */
export function clearKind(
  criteria: FilterCriteria,
  kind: FilterKind,
): FilterCriteria {
  switch (kind) {
    case "dateRange":
      return { ...criteria, dateRange: undefined };
    case "person":
      return { ...criteria, assigneeGids: null };
    case "project":
      return { ...criteria, projectGids: null };
    case "completion":
      return { ...criteria, completionState: null };
    case "priority":
      return { ...criteria, priorityOptionIds: null };
    case "estimate":
      return { ...criteria, estimateState: null };
    case "overdue":
      return { ...criteria, overdueState: null };
  }
}

/** The criteria with every removable filter removed; the window stays. */
export function clearRemovable(criteria: FilterCriteria): FilterCriteria {
  return { dateRange: criteria.dateRange };
}

/** Whether any pill other than the reporting window is in force. */
export function hasRemovableFilters(criteria: FilterCriteria): boolean {
  return activeKinds(criteria).some(isRemovable);
}

function namesFor(
  gids: readonly string[],
  options: readonly FilterValueOption[],
): string {
  const names = gids.map(
    (gid) => options.find((option) => option.gid === gid)?.name ?? gid,
  );
  if (names.length <= 2) {
    return names.join(", ");
  }
  return `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
}

/** Everything a pill needs to put a gid or an enum into words. */
export interface DescribeContext {
  readonly users: readonly FilterValueOption[];
  readonly projects: readonly FilterValueOption[];
  readonly timezone: TimezoneSetting;
}

/** The value half of a pill ("Ana, Ben +1", "Last 30 days"). */
export function describeValue(
  criteria: FilterCriteria,
  kind: FilterKind,
  context: DescribeContext,
): string {
  switch (kind) {
    case "dateRange": {
      const range = criteria.dateRange;
      if (range === undefined) {
        return "";
      }
      if (range.preset !== "custom") {
        return PRESET_LABELS[range.preset];
      }
      return `${formatDate(range.start, context.timezone)} – ${formatDate(
        range.end,
        context.timezone,
      )}`;
    }
    case "person":
      return criteria.assigneeGids === "unassigned"
        ? "Unassigned"
        : namesFor(criteria.assigneeGids ?? [], context.users);
    case "project":
      return namesFor(criteria.projectGids ?? [], context.projects);
    case "priority":
      return "Missing";
    case "completion":
      return criteria.completionState === "complete"
        ? "Complete"
        : "Incomplete";
    case "estimate":
      return criteria.estimateState === "estimated"
        ? "Estimated"
        : "Not estimated";
    case "overdue": {
      const state = criteria.overdueState;
      if (state === "overdue") {
        return "Overdue";
      }
      return state === "on_time" ? "On time" : "No due date";
    }
  }
}

/** The single value a single-choice kind currently holds, or `""`. */
export function currentChoice(
  criteria: FilterCriteria,
  kind: FilterKind,
): string {
  switch (kind) {
    case "completion":
      return criteria.completionState ?? "";
    case "priority":
      return criteria.priorityOptionIds === "no_priority" ? "no_priority" : "";
    case "estimate":
      return criteria.estimateState ?? "";
    case "overdue":
      return criteria.overdueState ?? "";
    default:
      return "";
  }
}

/** The criteria with a single-choice kind set to one of its choices. */
export function withChoice(
  criteria: FilterCriteria,
  kind: FilterKind,
  value: string,
): FilterCriteria {
  switch (kind) {
    case "completion":
      return {
        ...criteria,
        completionState: value === "complete" ? "complete" : "incomplete",
      };
    case "priority":
      return { ...criteria, priorityOptionIds: "no_priority" };
    case "estimate":
      return {
        ...criteria,
        estimateState: value === "estimated" ? "estimated" : "unestimated",
      };
    case "overdue":
      return {
        ...criteria,
        overdueState:
          value === "overdue" || value === "on_time" ? value : "no_due_date",
      };
    default:
      return criteria;
  }
}
