/**
 * Cross-cutting domain types for the Asana Team Performance & Workload
 * Dashboard.
 *
 * Every type in this module is the shared vocabulary the rest of the
 * application speaks:
 *
 * - `FilterCriteria` and `MetricContext` are the inputs every metric
 *   calculator (`src/domain/metrics/**`) accepts (contracts/metrics-engine.md).
 * - `MetricResult<TSeries>` is the shape every metric calculator returns,
 *   so every UI surface gets drill-down and denominator visibility for free
 *   (data-model.md: Cross-cutting reporting types).
 * - `ViewState` enumerates every required UI state (FR-085) as a single
 *   discriminated union so a feature component cannot compile against an
 *   unhandled case.
 * - `DataQualityFlag` is the per-gid data-completeness indicator shared by
 *   the FR-084 refresh summary and the FR-079 P2 data-quality panel.
 *
 * The file contains NO React, browser, or network imports — `src/domain/**`
 * is the architectural boundary that Constitution Principle VI protects via
 * `eslint-plugin-boundaries` (research.md §7). Any feature, app, or data
 * import here would break the CI lint gate.
 *
 * Branded primitives (`ISODate`, `ISODateTime`) use TypeScript's structural
 * intersection pattern (`string & { readonly __brand: ... }`) so a plain
 * string cannot accidentally be passed where a calendar date is required,
 * while still serialising through JSON and IndexedDB unchanged.
 */

/* -------------------------------------------------------------------------- */
/* Date / time primitives                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A calendar date in `YYYY-MM-DD` form, evaluated under the active
 * `TimezoneSetting` (FR-029, FR-034). Date-only Asana due dates are
 * normalised to a documented time boundary under the active timezone
 * (FR-030); the date string itself is timezone-free.
 */
export type ISODate = string & { readonly __isoDateBrand: unique symbol };

/**
 * An instant in time serialised as an ISO-8601 string. The cache, the
 * RefreshSession state machine, and the `MetricResult.asOf` freshness label
 * (FR-090) all carry this primitive; the wire form is a plain string so it
 * survives IndexedDB round-trips and JSON serialisation without bespoke
 * (de)serialisation.
 */
export type ISODateTime = string & {
  readonly __isoDateTimeBrand: unique symbol;
};

/**
 * The fixed set of date-range presets the filter UI offers per FR-032.
 * Weeks start on Monday (FR-031) and the range is evaluated under the
 * active `TimezoneSetting`. A literal `FilterCriteria.dateRange.preset`
 * may also be `'custom'` to indicate a user-entered start/end pair.
 */
export type DateRangePreset =
  | "this_week"
  | "last_week"
  | "last_30_days"
  | "this_month"
  | "last_month"
  | "this_quarter";

/**
 * Runtime enumeration of every supported `DateRangePreset`, exposed so the
 * filter UI, preset tests, and i18n catalogues can iterate the values
 * without hard-coding the literal union in multiple places.
 */
export const DATE_RANGE_PRESETS: readonly DateRangePreset[] = [
  "this_week",
  "last_week",
  "last_30_days",
  "this_month",
  "last_month",
  "this_quarter",
] as const;

/**
 * A user-entered or preset-resolved date range. `preset === 'custom'`
 * denotes a free-form start/end pair; any other preset value is one of
 * `DATE_RANGE_PRESETS`.
 */
export interface DateRange {
  start: ISODate;
  end: ISODate;
  preset: DateRangePreset | "custom";
}

/**
 * The timezone basis reporting uses, per FR-029 (default local) and
 * FR-034 (user-toggleable to UTC). Every date-bucketed chart and range
 * boundary recalculates consistently under the newly selected basis
 * rather than mixing bases.
 */
export type TimezoneSetting = "local" | "utc";

/**
 * The fixed first day of an ISO week per FR-031. Held as a literal type so
 * metric calculators can read it from `MetricContext` without drift.
 */
export type WeekStart = "monday";

/* -------------------------------------------------------------------------- */
/* Team mapping cross-cutting shape                                            */
/* -------------------------------------------------------------------------- */

/**
 * A single reporting-team override for a project (FR-044, FR-046). The
 * `projectGid` is the primary key; the override survives every refresh and
 * is consulted by `MetricContext.teamMapping` (the *current* mapping only —
 * historical reporting-team attribution does not exist; FR-046).
 *
 * The shape mirrors the `teamMappingOverrides` Dexie row
 * (`contracts/storage-repository.md`) so the data layer's repository
 * implementation satisfies this contract directly without translation.
 */
export interface TeamMappingOverride {
  projectGid: string;
  reportingTeamGid: string;
  updatedAt: ISODateTime;
}

/* -------------------------------------------------------------------------- */
/* FilterCriteria (FR-047 / FR-048)                                            */
/* -------------------------------------------------------------------------- */

/**
 * The user-facing filter selection, every field optional and combinable
 * (FR-047/FR-048). `assigneeGids` and `priorityOptionIds` accept a literal
 * `'unassigned'` / `'no_priority'` sentinel to match how the data layer
 * represents those explicit states (data-model.md: `User` /
 * `Task.priorityOptionId`).
 */
export interface FilterCriteria {
  dateRange?: DateRange;
  assigneeGids?: string[] | "unassigned" | null;
  reportingTeamIds?: string[] | null;
  asanaTeamGids?: string[] | null;
  personGroupIds?: string[] | null;
  projectGids?: string[] | null;
  portfolioGids?: string[] | null;
  priorityOptionIds?: string[] | "no_priority" | null;
  completionState?: "incomplete" | "complete" | null;
  overdueState?: "overdue" | "on_time" | "no_due_date" | null;
  estimateState?: "estimated" | "unestimated" | null;
  blockedOnly?: boolean;
  stalledOnly?: boolean;
}

/* -------------------------------------------------------------------------- */
/* MetricContext (contracts/metrics-engine.md shared input)                    */
/* -------------------------------------------------------------------------- */

/**
 * Shared input every metric calculator receives
 * (`contracts/metrics-engine.md`). The clock is injected so tests are
 * deterministic; the active timezone and week-start are part of the
 * context so the calculator does not read environment state directly.
 * `teamMapping` is the *current* mapping — there is no point-in-time
 * history (FR-046); historical reporting-team attribution uses today's
 * mapping retroactively, which is a documented limitation surfaced in
 * the UI (data-model.md: backlog reconstruction).
 */
export interface MetricContext {
  now: ISODateTime;
  timezone: TimezoneSetting;
  weekStart: WeekStart;
  teamMapping: TeamMappingOverride[];
}

/* -------------------------------------------------------------------------- */
/* MetricResult<TSeries> (shared output of every metric calculator)           */
/* -------------------------------------------------------------------------- */

/**
 * A population exclusion row (FR-058, FR-049). `reason` is a free-form
 * short label so a metric can declare its own domain-specific exclusion
 * categories (e.g. `'no_estimate'`, `'milestone_excluded'`,
 * `'time_tracking_unavailable'`) without forcing every consumer to
 * pre-declare them; the metric's own vocabulary drives the disclosure
 * and the UI renders `reason` verbatim per the Principle II "no hidden
 * composite" rule.
 */
export interface ExcludedPopulationEntry {
  reason: string;
  count: number;
}

/**
 * The population summary at the top of every `MetricResult`. `total` is the
 * count of in-scope tasks that satisfied the filter before any
 * missing-value exclusion; `excluded` discloses each reason a task was
 * left out of the *summed* metric (e.g. unestimated tasks dropped from an
 * effort total) so the UI can show the rule instead of hiding the gap.
 */
export interface MetricPopulation {
  total: number;
  excluded?: ExcludedPopulationEntry[];
}

/**
 * Drill-down set a metric attaches to its result (FR-052, FR-062, FR-067).
 * Either a flat list of `gid`s for an ungrouped metric, or a
 * `bucketKey → gid[]` map when the metric is grouped so the drill-down
 * preserves the same partitioning the chart shows.
 */
export type ContributingTaskGids = string[] | Record<string, string[]>;

/**
 * Shared result envelope every metric calculator returns. The four rules
 * from `contracts/metrics-engine.md` (deduplication, multi-team/multi-group
 * attribution, missing-value disclosure, drill-down parity) all flow
 * through this shape — `dedupApplied` is the literal `true` marker so
 * metric unit tests can lint-visible-assert FR-036 was honoured.
 */
export interface MetricResult<TSeries> {
  population: MetricPopulation;
  series: TSeries;
  contributingTaskGids: ContributingTaskGids;
  dedupApplied: true;
  asOf: ISODateTime;
}

/* -------------------------------------------------------------------------- */
/* ViewState (FR-085, FR-087)                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The discriminated union of every UI state a feature component must
 * handle (FR-085, FR-087). Adding a state here forces every consumer to
 * handle it at compile time — the canonical "exhaustive switch" pattern
 * from Principle VII (Accessible, Honest, Responsive UX).
 */
export type ViewState =
  | "loading"
  | "first_run"
  | "empty"
  | "cached_stale"
  | "offline"
  | "invalid_token"
  | "insufficient_permission"
  | "rate_limited"
  | "partial_data"
  | "no_results"
  | "ready";

/**
 * Runtime type-guard for an unknown string so a feature module can
 * defend against data arriving from outside the typed boundary (e.g. an
 * IndexedDB record from a future schema that introduces a new state).
 */
export function isViewState(value: unknown): value is ViewState {
  return (
    typeof value === "string" &&
    (VIEW_STATES as readonly string[]).includes(value)
  );
}

const VIEW_STATES: readonly ViewState[] = [
  "loading",
  "first_run",
  "empty",
  "cached_stale",
  "offline",
  "invalid_token",
  "insufficient_permission",
  "rate_limited",
  "partial_data",
  "no_results",
  "ready",
] as const;

/* -------------------------------------------------------------------------- */
/* DataQualityFlag (FR-079 / FR-084)                                           */
/* -------------------------------------------------------------------------- */

/**
 * The set of data-completeness indicator kinds enumerated by FR-079 and
 * surfaced in the FR-084 refresh summary. `malformed_priority` is
 * distinguished from `missing_priority` because a present-but-invalid
 * Priority field (FR-081/FR-082) carries a different remediation signal
 * than a missing field.
 */
export type DataQualityFlagKind =
  | "missing_assignee"
  | "missing_estimate"
  | "missing_priority"
  | "malformed_priority"
  | "missing_due_date"
  | "missing_actual_time";

/**
 * A single data-completeness finding. The same scan produces the
 * drillable refresh summary (FR-084) and the P2 data-quality-indicators
 * metric (FR-079) — `taskGids` is the drill-down set, `count` is its
 * length cached for cheap rendering, and the two MUST stay in sync.
 */
export interface DataQualityFlag {
  kind: DataQualityFlagKind;
  taskGids: string[];
  count: number;
}

/**
 * Runtime type-guard for the `DataQualityFlagKind` literal union so a
 * metric scan cannot accidentally widen a kind and silently fall through
 * an unhandled case.
 */
export function isDataQualityFlagKind(
  value: unknown,
): value is DataQualityFlagKind {
  return (
    typeof value === "string" &&
    (DATA_QUALITY_FLAG_KINDS as readonly string[]).includes(value)
  );
}

const DATA_QUALITY_FLAG_KINDS: readonly DataQualityFlagKind[] = [
  "missing_assignee",
  "missing_estimate",
  "missing_priority",
  "malformed_priority",
  "missing_due_date",
  "missing_actual_time",
] as const;
