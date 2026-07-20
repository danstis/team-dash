# Contract: Metrics Engine (`src/domain/metrics`)

Per Constitution Principle II/VI, every metric is a pure function:
`(tasks: Task[], filter: FilterCriteria, context: MetricContext) => MetricResult<TSeries>`
— no React, no DOM, no network, no wall-clock reads other than through
`context.now` (injected, so tests are deterministic). This contract
defines the shared function signature pattern and specifies the four P1
metrics in full; P2 metrics (US6–10) implement the same signature pattern
against their own `TSeries` shape, documented at their own implementation
time per Constitution Principle I, but MUST satisfy the shared rules
below without exception — this is the enforcement point for FR-080
("every P2 metric MUST document... consistent with the P1 metrics").

## Shared input types

```
interface MetricContext {
  now: ISODateTime;               // injected clock, never Date.now() directly
  timezone: 'local' | 'utc';      // FR-029/FR-034
  weekStart: 'monday';            // FR-031, fixed
  teamMapping: TeamMappingOverride[]; // current mapping only, FR-046
}
```

Every calculator receives the **already in-scope-filtered** task list
(the in-scope predicate from data-model.md is applied once, upstream, by
the calling layer — no individual metric re-derives scope) plus the active
`FilterCriteria`, so metric code never has to know how "in scope" is
determined, only how to apply the *user's chosen* filters on top of it.

## Shared output rules (apply to every metric, P1 and P2 alike)

1. **Deduplication (FR-036/FR-038/FR-039/FR-040)**: any total at or above
   single-project grouping MUST deduplicate by `gid` using
   `domain/dedup`'s `dedupeByGid` helper — never a hand-rolled `Set` per
   metric, so the dedup rule cannot silently diverge between metrics.
2. **Multi-team/multi-group attribution (FR-045/FR-042e)**: when a
   grouping dimension allows a task to belong to more than one group
   (reporting team, Person Group), the per-group totals MUST each include
   the task, while any ungrouped/workspace-level total in the same result
   MUST still be deduplicated per rule 1 — both figures are computed from
   the same `dedupeByGid`-underpinned source, never approximated.
3. **Missing-value disclosure (FR-049/FR-058)**: any exclusion from a sum
   (e.g., unestimated tasks from an effort total) MUST be reported via
   `MetricResult.population.excluded`, never left implicit.
4. **Zero-denominator handling**: a rate metric (e.g., on-time completion
   rate) with a zero denominator MUST return an explicit
   `{ notApplicable: true }` marker in its `TSeries`, never `0` or `NaN`
   (Edge Cases: "zero denominator for a rate-based metric").
5. **Drill-down parity (FR-052/FR-062/FR-067)**: `contributingTaskGids`
   MUST, when re-fetched and re-aggregated, reproduce exactly the
   displayed count/sum — this is asserted generically by a shared test
   helper (`assertDrillDownMatchesSummary`) reused across every metric's
   test file rather than re-implemented per metric.
6. **Determinism**: given identical `(tasks, filter, context)`, a
   calculator MUST return byte-identical output — no `Math.random`, no
   unseeded iteration-order dependence (`gid`-keyed Maps, sorted output
   arrays where order is user-visible).

## P1 — Work Added / Work Completed (FR-056–062)

```
type WorkAddedCompletedSeries = {
  buckets: Array<{
    bucketStart: ISODate;
    bucketEnd: ISODate;
    createdCount: number;
    completedCount: number;
    createdEffortMinutes: number;   // sum, unestimated excluded
    completedEffortMinutes: number; // sum, unestimated excluded
  }>;
  createdUnestimatedCount: number;
  completedUnestimatedCount: number;
};

function calculateWorkAddedVsCompleted(
  tasks: Task[], filter: FilterCriteria, context: MetricContext,
  groupBy?: 'assignee' | 'reportingTeam' | 'project' | 'portfolio' | 'priority'
): MetricResult<WorkAddedCompletedSeries> | Record<string, MetricResult<WorkAddedCompletedSeries>>;
```

- Bucket width auto-selected from the range length (daily for ranges ≤ ~45
  days, weekly beyond — exact thresholds fixed at implementation, but MUST
  stay deterministic and be documented in code) per FR-059.
- Created-count population: `task.createdAt` within range. Completed-count
  population: `task.completedAt` within range. These are independent scans
  over the same input array — a task can appear in both without
  double-affecting the other bucket (FR-056/FR-057, US4 Acceptance
  Scenario 1: "each independently").
- `groupBy` splits `series.buckets` into one keyed result per group value
  including an explicit `'unassigned'`/`'no_priority'` key (FR-060,
  Acceptance Scenario US4.3); ungrouped call omits the parameter and
  returns a single `MetricResult`.
- Item-count and effort views are two fields on the *same* bucket, never
  merged into one blended number client-side (FR-061) — the UI toggles
  which field it reads, it does not request two different calculator
  calls that could drift.

## P1 — Backlog Size & Backlog Direction (FR-063–068)

```
type BacklogPointSeries = {
  points: Array<{
    date: ISODate;              // reconstructed calendar date
    incompleteCount: number;
    incompleteEffortMinutes: number;
    unestimatedIncompleteCount: number;
  }>;
  trend: 'up' | 'down' | 'flat';       // count trend across `points`
  effortTrend: 'up' | 'down' | 'flat'; // effort trend, reported separately
};

function calculateBacklogCurrent(
  tasks: Task[], filter: FilterCriteria, context: MetricContext
): MetricResult<{ incompleteCount: number; incompleteEffortMinutes: number; unestimatedIncompleteCount: number }>;

function calculateBacklogDirection(
  tasks: Task[], filter: FilterCriteria, context: MetricContext,
  range: { start: ISODate; end: ISODate }
): MetricResult<BacklogPointSeries>;
```

- `calculateBacklogDirection` implements the single reconstruction
  predicate from research.md §11
  (`createdAt <= d && (completedAt == null || completedAt > d)`) for every
  `d` in `range`; it MUST be the *only* place this predicate is
  implemented — the Snapshot-cache read path (data layer) is a memoised
  wrapper that calls this same function for backfill, never a parallel
  reimplementation (this is what FR-026a/b and the "no drift between live
  and cached figures" goal in research.md require).
- Historical `incompleteEffortMinutes` uses each task's **current**
  `estimatedMinutes` applied retroactively — this is a documented
  limitation (FR-066), not a bug; the calculator's JSDoc and a rendered
  UI disclosure both state it, and a unit test asserts the retroactive
  behaviour explicitly so it cannot be "fixed" into point-in-time estimate
  tracking without a deliberate spec change.
- `contributingTaskGids` for a historical point reflects tasks *currently*
  known to satisfy the predicate for that date — consistent with FR-028's
  "history can shift on a later refresh" rule; no attempt is made to
  reconstruct a task that has left scope entirely (deleted, e.g.) since
  its dates are no longer in the cache to evaluate.
- Reporting-team-grouped calls always resolve team membership via
  `context.teamMapping` (the *current* mapping) for every historical
  point, per FR-046 — there is no point-in-time mapping to look up.

## P2 metric pattern (documented at implementation time, US6–10)

Each P2 metric (`calculateAssignedWorkload`, `calculateOverdue`,
`calculateOnTimeRate`, `calculateCompletedByPriority`, `calculateBlocked`,
`calculateStalled`, `calculateAverageAge`, `calculateCycleTime`,
`calculateDataQuality`, `calculateEstimateVarianc e`) MUST:

1. Follow the same `(tasks, filter, context, …) => MetricResult<TSeries>`
   signature shape.
2. Satisfy all six Shared Output Rules above.
3. Have its `TSeries` shape and population/date-basis/numerator/
   denominator/missing-value/dedup/unit/drill-down documented in a
   contract addendum (or inline JSDoc block referencing spec.md's Metric
   Definitions section for that metric) before the corresponding task in
   `tasks.md` is marked complete — this is the concrete, checkable form of
   FR-080 and the constitution's Compliance Checklist item on metric
   documentation.

## Test contract

`tests/unit/domain/metrics/*.test.ts` — one file per calculator — MUST,
at minimum:

- Assert exact figures against a hand-computed fixture (mirrors SC-005's
  "100% of P1 metric figures match expected values").
- Assert `dedupApplied === true` and correct counting for a task
  belonging to 2+ projects/teams/groups.
- Assert the documented missing-value/zero-denominator behaviour.
- Assert `assertDrillDownMatchesSummary` passes for at least one bucket
  and one grouped case.
