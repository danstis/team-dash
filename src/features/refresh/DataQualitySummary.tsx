/**
 * T04 — `DataQualitySummary` (S01, FR-079 / FR-084).
 *
 * The dashboard's data-quality surface: enumerates the FR-084
 * findings (`DataQualityFlag[]`) observed against the cache the
 * most-recent successful refresh produced. The component is a pure
 * renderer — the flag derivation lives in `deriveDataQualityFlags()`
 * below so the unit suite can exercise the aggregation rules
 * deterministically without seeding the cache.
 *
 * Flag catalogue (from `src/domain/types.ts`):
 *
 * - `missing_assignee` — `task.assigneeGid === null`
 * - `missing_estimate` — `task.estimatedMinutes === null` (the
 *   "Estimated Time" custom field was absent on the task)
 * - `missing_priority` — `task.priorityOptionId === null` (no
 *   "Priority" custom field enumerated a value)
 * - `missing_due_date` — `task.dueAt === null` (no due instant set
 *   on the wire; `due_on`-only dates are normalised at render time,
 *   not in the cache, so the cache's `dueAt === null` is the
 *   trigger)
 * - `malformed_priority` — at least one project the task belongs to
 *   has a `PriorityField` row with `status === 'malformed'` (some
 *   tasks carry the field, some do not). The flag is attributed to
 *   every task in any such project because the project-level
 *   structural gap affects them all.
 * - `missing_actual_time` — Asana does not surface actual time, so
 *   the cache's `actualMinutes` is always `null`. We deliberately
 *   skip this kind: a constant "missing actual time" flag across
 *   every workspace would be a false signal. The kind remains in
 *   the `DataQualityFlagKind` union for a future Asana actual-time
 *   integration.
 *
 * Resource subtypes: only `default_task` rows are scanned. The
 * `milestone` and `approval` subtypes are explicitly excluded
 * because they are not part of the reportable metric (FR-015) and
 * reporting "missing assignee" on a milestone row would be a false
 * signal — milestones have no owner concept in the project model.
 *
 * Anchors
 * -------
 * - `data-testid="data-quality-summary"` — pinned by the S01
 *   verification.
 * - `data-quality-empty="true"` — set when zero flags are observed;
 *   absent (or `"false"`) otherwise.
 * - `data-quality-flag-<kind>="<count>"` — one attribute per
 *   observed kind, so a regression test can pin a specific kind
 *   count without scraping text.
 *
 * Boundary
 * --------
 * `src/features/refresh/**` is the feature boundary documented in
 * the plan. This module depends only on React and on
 * `src/domain/types` for the `DataQualityFlag` / `DataQualityFlagKind`
 * shapes; it does not import from `src/data/**` (the dashboard owns
 * the Dexie read; the component receives the rows as a prop).
 */
import type { ReactElement } from "react";

import type {
  DataQualityFlag,
  DataQualityFlagKind,
} from "../../domain/types";
import type { PriorityField, Task } from "../../data/db/schema";

/**
 * The closed set of `DataQualityFlagKind` values the summary
 * aggregation considers. Mirrors `DataQualityFlagKind` but excludes
 * `missing_actual_time` (see module docstring for rationale). The
 * explicit tuple (rather than a `Set`) keeps the iteration order
 * deterministic so the rendered `<li>` order is reproducible across
 * runs.
 */
export const DERIVED_FLAG_KINDS: readonly DataQualityFlagKind[] = [
  "missing_assignee",
  "missing_estimate",
  "missing_priority",
  "missing_due_date",
  "malformed_priority",
] as const;

/**
 * Build the FR-084 `DataQualityFlag[]` for the supplied task cache.
 *
 * Pure function. Pure so the unit suite can exercise every branch
 * (malformed-priority project scoping, milestone exclusion,
 * missing-priority vs missing-attribute confusion) without seeding
 * IndexedDB. The dashboard passes in `tasks` and `priorityFields`
 * already loaded via `useLiveQuery`; the summary receives the
 * derived `DataQualityFlag[]` as a prop.
 *
 * @param tasks          The cached `Task` rows to scan.
 * @param priorityFields The cached `PriorityField` rows (project
 *                       level priority-field status). Used to derive
 *                       `malformed_priority`.
 * @returns              The aggregated `DataQualityFlag[]`. Kinds
 *                       with a zero count are omitted (no
 *                       `count: 0` rows).
 */
export function deriveDataQualityFlags(
  tasks: readonly Task[],
  priorityFields: readonly PriorityField[],
): DataQualityFlag[] {
  const malformedPriorityProjectGids = new Set<string>();
  for (const field of priorityFields) {
    if (field.status === "malformed") {
      malformedPriorityProjectGids.add(field.projectGid);
    }
  }

  // Per-kind task gid buckets. Reset on every call so the function
  // remains referentially transparent for the unit suite.
  const taskGidsByKind = new Map<DataQualityFlagKind, string[]>();
  for (const kind of DERIVED_FLAG_KINDS) {
    taskGidsByKind.set(kind, []);
  }

  for (const task of tasks) {
    // FR-015: milestones and approvals are not part of the
    // reportable metric. Surfacing "missing assignee" on a milestone
    // row would be a false signal.
    if (task.resourceSubtype !== "default_task") {
      continue;
    }

    if (task.assigneeGid === null) {
      taskGidsByKind.get("missing_assignee")?.push(task.gid);
    }
    if (task.estimatedMinutes === null) {
      taskGidsByKind.get("missing_estimate")?.push(task.gid);
    }
    if (task.priorityOptionId === null) {
      taskGidsByKind.get("missing_priority")?.push(task.gid);
    }
    if (task.dueAt === null) {
      taskGidsByKind.get("missing_due_date")?.push(task.gid);
    }
    if (task.projectGids.some((gid) => malformedPriorityProjectGids.has(gid))) {
      taskGidsByKind.get("malformed_priority")?.push(task.gid);
    }
  }

  const flags: DataQualityFlag[] = [];
  for (const kind of DERIVED_FLAG_KINDS) {
    const gids = taskGidsByKind.get(kind) ?? [];
    if (gids.length === 0) {
      continue;
    }
    flags.push({ kind, taskGids: gids, count: gids.length });
  }
  return flags;
}

/**
 * Human-friendly label per flag kind. The mapper lives in the
 * component module (not in `src/domain`) because it is presentation
 * copy, not domain vocabulary. Keeping it here means a future
 * i18n migration translates the summary in one place.
 */
export const DATA_QUALITY_FLAG_LABELS: Readonly<
  Record<DataQualityFlagKind, string>
> = {
  missing_assignee: "Missing assignee",
  missing_estimate: "Missing estimate",
  missing_priority: "Missing priority",
  missing_due_date: "Missing due date",
  malformed_priority: "Malformed priority field on a project",
  missing_actual_time: "Missing actual time",
};

export interface DataQualitySummaryProps {
  /**
   * The aggregated `DataQualityFlag[]` the most-recent refresh
   * produced. The dashboard derives this from the live cache via
   * `deriveDataQualityFlags()`. The summary does NOT compute the
   * flags itself — doing so would couple the summary to Dexie and
   * make it untestable without seeding the cache.
   */
  readonly flags: readonly DataQualityFlag[];
  /**
   * Per-kind data attribute prefix. The default `"data-quality-flag-"`
   * matches the S01 verification contract; tests pass an empty
   * string to strip the prefix when the rendered surface is asserted
   * via the rendered DOM rather than the attributes.
   */
  readonly attributePrefix?: string;
}

/**
 * The FR-084 data-quality summary surface.
 *
 * Rendered ONCE per dashboard view (after `FreshnessBanner` when a
 * succeeded session exists). The component renders nothing when
 * `flags` is empty — the absence of the summary is the "no
 * findings" UX (per the spec's "no false signals" rule).
 *
 * Empty path: when `flags.length === 0`, the summary renders an
 * `aria-live="polite"` `<section>` with `data-quality-empty="true"`
 * and a copy confirming the scan saw no issues. The `data-testid`
 * is preserved so a regression test can pin "empty path is still
 * reachable" independently of copy changes.
 */
export function DataQualitySummary({
  flags,
  attributePrefix = "data-quality-flag-",
}: Readonly<DataQualitySummaryProps>): ReactElement {
  const isEmpty = flags.length === 0;
  // Per the S01 verification contract ("data-quality-summary with
  // data-quality-flag-* attributes"), the per-kind count attrs live
  // on the summary element itself, not on the inner <li>s. A single
  // selector against the summary therefore reads every observed
  // kind without DOM traversal — the surface a future contributor
  // pins against for the data-quality contract.
  const dataAttrs: Record<string, string> = {};
  for (const flag of flags) {
    dataAttrs[`${attributePrefix}${flag.kind}`] = String(flag.count);
  }
  return (
    <section
      className="td-data-quality-summary"
      data-testid="data-quality-summary"
      data-quality-empty={isEmpty ? "true" : "false"}
      role={isEmpty ? "status" : "alert"}
      aria-live="polite"
      aria-label={
        isEmpty
          ? "Data quality summary: no findings"
          : `Data quality summary: ${flags.length} finding${flags.length === 1 ? "" : "s"}`
      }
      {...dataAttrs}
    >
      <h2>Data quality summary</h2>
      {isEmpty ? (
        <p data-testid="data-quality-summary-empty">
          No data-quality issues observed in the most recent refresh.
        </p>
      ) : (
        <ul data-testid="data-quality-summary-list">
          {flags.map((flag) => (
            <li
              key={flag.kind}
              data-testid={`data-quality-item-${flag.kind}`}
            >
              <span>{DATA_QUALITY_FLAG_LABELS[flag.kind]}</span>:{" "}
              <strong data-testid={`data-quality-count-${flag.kind}`}>
                {flag.count}
              </strong>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default DataQualitySummary;
