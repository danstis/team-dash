/**
 * T075 — `calculateWorkAddedVsCompleted` unit tests (Red phase).
 *
 * The P1 work-added / work-completed metric is the MVP's primary
 * reporting outcome (US4), and SC-005 requires "100% of P1 metric
 * figures (work added/completed counts and effort, backlog
 * count/effort/direction) match the expected values" in a controlled
 * fixture. This suite is that controlled fixture: every figure is
 * compared against a HAND-COMPUTED reference file,
 * `fixtures/asana/small-dataset/expected-metrics.json`, which is derived
 * from `fixtures/asana/small-dataset/data.ts` by hand — never by running
 * the implementation.
 *
 * Coverage
 * --------
 * - FR-056 / FR-057: created and completed are two INDEPENDENT scans
 *   over the same task list, so a task can be counted in one, the other,
 *   or both.
 * - FR-058: tasks without an estimate are excluded from the effort sums
 *   and the exclusion is disclosed (population + series counters).
 * - FR-059: the bucket width is auto-selected from the range length
 *   (daily up to 45 days, weekly beyond) and the weekly buckets snap
 *   back to the Monday week-start (FR-031).
 * - FR-060: grouping by assignee, reporting team, project, portfolio and
 *   priority — including the explicit `unassigned` / `no_priority` keys.
 * - FR-061: the item-count view and the estimated-effort view are two
 *   fields of the same bucket, never one blended number.
 * - FR-062 / `contracts/metrics-engine.md` Shared Output Rule 5: every
 *   displayed figure is drillable, and re-fetching the drill-down's
 *   tasks reproduces the displayed count and sum exactly (asserted
 *   through the shared `assertDrillDownMatchesSummary` helper).
 * - FR-036 / Shared Output Rule 1: a task that belongs to two projects
 *   is counted exactly once in the workspace-level figures.
 *
 * The tests MUST fail before `src/domain/metrics/workAddedCompleted.ts`
 * computes anything and pass after it, per Constitution Principle III.
 * The module lives under `src/domain/**` and therefore stays
 * presentation-free, browser-free, and network-free (ESLint boundary
 * rule, `eslint.config.js`) — no Dexie, no fetch, no React.
 *
 * Determinism
 * ------------
 * Every assertion runs under the UTC timezone basis, so the figures hold
 * on every host regardless of the local clock. `TZ` is pinned anyway to
 * match the other domain suites.
 */
process.env.TZ = "Australia/Sydney";

import { describe, expect, it } from "vitest";

import {
  calculateWorkAddedVsCompleted,
  NO_PRIORITY_GROUP_KEY,
  UNASSIGNED_GROUP_KEY,
  type WorkAddedCompletedSeries,
  type WorkAddedCompletedTask,
} from "../../../../src/domain/metrics/workAddedCompleted";
import type {
  FilterCriteria,
  ISODate,
  ISODateTime,
  MetricContext,
  MetricResult,
} from "../../../../src/domain/types";
import { smallDataset } from "../../../../fixtures/asana/small-dataset/data";
import expectedMetrics from "../../../../fixtures/asana/small-dataset/expected-metrics.json";
import {
  assertDrillDownMatchesSummary,
  type ReaggregatedFigure,
} from "./support/assertDrillDownMatchesSummary";

/* -------------------------------------------------------------------------- */
/* The hand-computed reference fixture                                         */
/* -------------------------------------------------------------------------- */

interface ReferenceBucket {
  readonly bucketStart: string;
  readonly bucketEnd: string;
  readonly createdCount: number;
  readonly completedCount: number;
  readonly createdEffortMinutes: number;
  readonly completedEffortMinutes: number;
}

interface ReferenceFigure {
  readonly population: {
    readonly total: number;
    readonly excluded: readonly {
      readonly reason: string;
      readonly count: number;
    }[];
  };
  readonly createdCount: number;
  readonly completedCount: number;
  readonly createdEffortMinutes: number;
  readonly completedEffortMinutes: number;
  readonly createdUnestimatedCount: number;
  readonly completedUnestimatedCount: number;
  readonly buckets: readonly ReferenceBucket[];
  readonly contributingTaskGids: Readonly<Record<string, readonly string[]>>;
}

interface ReferenceCase {
  readonly range: { readonly start: string; readonly end: string };
  readonly bucketWidth: "day" | "week";
  readonly bucketCount: number;
  readonly firstBucketStart: string;
  readonly lastBucketStart: string;
  readonly ungrouped: ReferenceFigure;
  readonly grouped?: Readonly<
    Record<string, Readonly<Record<string, ReferenceFigure>>>
  >;
}

interface ReferenceFixture {
  readonly scope: {
    readonly includedTaskGids: readonly string[];
    readonly excludedTasks: readonly {
      readonly gid: string;
      readonly reason: string;
    }[];
  };
  readonly cases: Readonly<Record<string, ReferenceCase>>;
}

/**
 * The reference file is a hand-computed artefact, not an implementation
 * output, so it is read through a local shape rather than through the
 * types the implementation happens to use. The assertions below are what
 * keep the two in step.
 */
const reference =
  expectedMetrics.workAddedCompleted as unknown as ReferenceFixture;

/* -------------------------------------------------------------------------- */
/* The fixture dataset, projected onto the metric's task shape                 */
/* -------------------------------------------------------------------------- */

interface RawCustomField {
  readonly name: string;
  readonly number_value?: number | null;
  readonly enum_value?: { readonly gid: string } | null;
}

interface RawTask {
  readonly gid: string;
  readonly name: string;
  readonly resource_subtype: string;
  readonly assignee: { readonly gid: string } | null;
  readonly projects: readonly { readonly gid: string }[];
  readonly parent: { readonly gid: string } | null;
  readonly created_at: string;
  readonly modified_at: string;
  readonly completed_at: string | null;
  readonly due_at: string | null;
  readonly due_on: string | null;
  readonly custom_fields: readonly RawCustomField[];
}

interface RawProject {
  readonly gid: string;
  readonly name: string;
  readonly archived: boolean;
  readonly team: { readonly gid: string } | null;
}

const rawTasks = smallDataset.tasks as readonly RawTask[];
const rawProjects = smallDataset.projects as readonly RawProject[];

function estimateOf(task: RawTask): number | null {
  const field = task.custom_fields.find((f) => f.name === "Estimated Time");
  return field?.number_value ?? null;
}

function priorityOf(task: RawTask): string | null {
  const field = task.custom_fields.find((f) => f.name === "Priority");
  return field?.enum_value?.gid ?? null;
}

/**
 * The fixture's portfolio row carries no project membership, so no task
 * in the fixture resolves to a portfolio. The portfolio grouping is
 * exercised further down with a purpose-built task list.
 */
function portfoliosOf(_projectGids: readonly string[]): readonly string[] {
  return [];
}

/**
 * Projects the raw Asana fixture onto the metric's task shape, applying
 * the in-scope predicate the calling layer owns (data-model.md):
 *
 * - only `default_task` rows take part in metrics (FR-015);
 * - a subtask's project memberships are resolved from its parent at
 *   ingestion time (FR-014);
 * - a task whose projects are all out of scope (archived) is dropped
 *   (FR-023).
 */
function buildScopedTasks(): WorkAddedCompletedTask[] {
  const projectByGid = new Map(rawProjects.map((p) => [p.gid, p]));
  const rawByGid = new Map(rawTasks.map((t) => [t.gid, t]));

  const scoped: WorkAddedCompletedTask[] = [];
  for (const raw of rawTasks) {
    if (raw.resource_subtype !== "default_task") {
      continue;
    }
    const parent = raw.parent ? rawByGid.get(raw.parent.gid) : undefined;
    const projectGids =
      raw.projects.length > 0
        ? raw.projects.map((p) => p.gid)
        : (parent?.projects.map((p) => p.gid) ?? []);
    if (!projectGids.some((gid) => projectByGid.get(gid)?.archived === false)) {
      continue;
    }
    scoped.push({
      gid: raw.gid,
      assigneeGid: raw.assignee?.gid ?? null,
      projectGids,
      createdAt: raw.created_at as ISODateTime,
      completedAt: (raw.completed_at ?? null) as ISODateTime | null,
      dueAt: (raw.due_at ?? null) as ISODateTime | null,
      priorityOptionId: priorityOf(raw),
      estimatedMinutes: estimateOf(raw),
      reportingTeamGids: [
        ...new Set(
          projectGids
            .map((gid) => projectByGid.get(gid)?.team?.gid)
            .filter((gid): gid is string => gid !== undefined),
        ),
      ],
      portfolioGids: portfoliosOf(projectGids),
    });
  }
  return scoped;
}

const scopedTasks = buildScopedTasks();

/* -------------------------------------------------------------------------- */
/* Metric inputs                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The injected clock and the reporting basis. `timezone: "utc"` keeps
 * every figure host-independent; the local basis is exercised by the
 * datetime suite, not here.
 */
const context: MetricContext = {
  now: "2026-07-31T12:00:00.000Z" as ISODateTime,
  timezone: "utc",
  weekStart: "monday",
  teamMapping: [],
};

function filterFor(start: string, end: string): FilterCriteria {
  return {
    dateRange: {
      start: start as ISODate,
      end: end as ISODate,
      preset: "custom",
    },
  };
}

const dailyCase = reference.cases.daily;
const weeklyCase = reference.cases.weekly;

/* -------------------------------------------------------------------------- */
/* Assertions against the reference fixture                                    */
/* -------------------------------------------------------------------------- */

/**
 * Compares a metric result with its hand-computed reference figure.
 *
 * The reference lists only the buckets that carry a figure; every other
 * bucket of the range must be all-zero, and the bucket sequence itself
 * is checked against the reference's own boundaries so a shifted or
 * missing bucket cannot slip through.
 */
function expectFigureMatchesReference(
  actual: MetricResult<WorkAddedCompletedSeries>,
  expected: ReferenceFigure,
  referenceCase: ReferenceCase,
): void {
  expect(actual.dedupApplied).toBe(true);
  expect(actual.asOf).toBe(context.now);
  expect(actual.population).toEqual(expected.population);
  expect(actual.series.createdUnestimatedCount).toBe(
    expected.createdUnestimatedCount,
  );
  expect(actual.series.completedUnestimatedCount).toBe(
    expected.completedUnestimatedCount,
  );

  expect(actual.series.buckets).toHaveLength(referenceCase.bucketCount);
  expect(actual.series.buckets[0]?.bucketStart).toBe(
    referenceCase.firstBucketStart,
  );
  expect(
    actual.series.buckets[actual.series.buckets.length - 1]?.bucketStart,
  ).toBe(referenceCase.lastBucketStart);

  for (const bucket of actual.series.buckets) {
    const listed = expected.buckets.find(
      (b) => b.bucketStart === bucket.bucketStart,
    );
    expect(bucket).toEqual(
      listed ?? {
        bucketStart: bucket.bucketStart,
        bucketEnd: bucket.bucketEnd,
        createdCount: 0,
        completedCount: 0,
        createdEffortMinutes: 0,
        completedEffortMinutes: 0,
      },
    );
  }
  for (const listed of expected.buckets) {
    expect(
      actual.series.buckets.some((b) => b.bucketStart === listed.bucketStart),
      `the reference bucket ${listed.bucketStart} is missing from the series`,
    ).toBe(true);
  }

  const total = (
    pick: (bucket: WorkAddedCompletedSeries["buckets"][number]) => number,
  ): number =>
    actual.series.buckets.reduce((sum, bucket) => sum + pick(bucket), 0);
  expect(total((bucket) => bucket.createdCount)).toBe(expected.createdCount);
  expect(total((bucket) => bucket.completedCount)).toBe(
    expected.completedCount,
  );
  expect(total((bucket) => bucket.createdEffortMinutes)).toBe(
    expected.createdEffortMinutes,
  );
  expect(total((bucket) => bucket.completedEffortMinutes)).toBe(
    expected.completedEffortMinutes,
  );

  expect(actual.contributingTaskGids).toEqual(expected.contributingTaskGids);
}

/**
 * The drill-down map of a result. The metric returns the map form for
 * every figure it reports (a flat list cannot express "the tasks behind
 * THIS bucket's created count"), so the test reads it as a map.
 */
function contributingMap(
  result: MetricResult<WorkAddedCompletedSeries>,
): Record<string, string[]> {
  return result.contributingTaskGids as Record<string, string[]>;
}

/**
 * Re-aggregates a set of tasks the way the metric does, independently of
 * the metric's own code: a task counts when its date on the given basis
 * falls inside the bucket, and its estimate joins the effort sum only
 * when it has one (FR-058).
 */
function reaggregate(
  basis: "created" | "completed",
  bucketStart: string,
  bucketEnd: string,
): (tasks: readonly WorkAddedCompletedTask[]) => ReaggregatedFigure {
  return (tasks) => {
    const inBucket = tasks.filter((task) => {
      const value = basis === "created" ? task.createdAt : task.completedAt;
      if (value === null) {
        return false;
      }
      const date = value.slice(0, 10);
      return date >= bucketStart && date <= bucketEnd;
    });
    return {
      count: inBucket.length,
      effortMinutes: inBucket.reduce(
        (sum, task) => sum + (task.estimatedMinutes ?? 0),
        0,
      ),
    };
  };
}

/* -------------------------------------------------------------------------- */
/* Tests                                                                       */
/* -------------------------------------------------------------------------- */

describe("calculateWorkAddedVsCompleted", () => {
  describe("against the hand-computed reference fixture (SC-005)", () => {
    it("scopes exactly the fixture tasks the in-scope predicate keeps", () => {
      expect(scopedTasks.map((task) => task.gid)).toEqual([
        ...reference.scope.includedTaskGids,
      ]);
      expect(reference.scope.excludedTasks.map((task) => task.gid)).toEqual([
        "1200000000000204",
      ]);
    });

    it("matches the reference figures for a daily range exactly", () => {
      const result = calculateWorkAddedVsCompleted(
        scopedTasks,
        filterFor(dailyCase.range.start, dailyCase.range.end),
        context,
      );

      expectFigureMatchesReference(result, dailyCase.ungrouped, dailyCase);
    });

    it("matches the reference figures for a weekly range exactly", () => {
      const result = calculateWorkAddedVsCompleted(
        scopedTasks,
        filterFor(weeklyCase.range.start, weeklyCase.range.end),
        context,
      );

      expectFigureMatchesReference(result, weeklyCase.ungrouped, weeklyCase);
    });
  });

  describe("grouping (FR-060)", () => {
    it("splits the series by assignee, including the explicit 'unassigned' key", () => {
      const grouped = calculateWorkAddedVsCompleted(
        scopedTasks,
        filterFor(dailyCase.range.start, dailyCase.range.end),
        context,
        "assignee",
      );

      const expected = dailyCase.grouped?.assignee ?? {};
      expect(Object.keys(grouped)).toEqual(Object.keys(expected));
      for (const [key, figure] of Object.entries(expected)) {
        expectFigureMatchesReference(
          grouped[key] as MetricResult<WorkAddedCompletedSeries>,
          figure,
          dailyCase,
        );
      }
      expect(grouped[UNASSIGNED_GROUP_KEY]).toBeDefined();
    });

    it("splits the series by priority, including the explicit 'no_priority' key", () => {
      const grouped = calculateWorkAddedVsCompleted(
        scopedTasks,
        filterFor(dailyCase.range.start, dailyCase.range.end),
        context,
        "priority",
      );

      const expected = dailyCase.grouped?.priority ?? {};
      expect(Object.keys(grouped)).toEqual(Object.keys(expected));
      for (const [key, figure] of Object.entries(expected)) {
        expectFigureMatchesReference(
          grouped[key] as MetricResult<WorkAddedCompletedSeries>,
          figure,
          dailyCase,
        );
      }
      expect(grouped[NO_PRIORITY_GROUP_KEY]).toBeDefined();
    });

    it("splits the series by project, keeping a multi-project task in each of its projects", () => {
      const grouped = calculateWorkAddedVsCompleted(
        scopedTasks,
        filterFor(dailyCase.range.start, dailyCase.range.end),
        context,
        "project",
      );

      const expected = dailyCase.grouped?.project ?? {};
      expect(Object.keys(grouped)).toEqual(Object.keys(expected));
      for (const [key, figure] of Object.entries(expected)) {
        expectFigureMatchesReference(
          grouped[key] as MetricResult<WorkAddedCompletedSeries>,
          figure,
          dailyCase,
        );
      }
    });

    it("splits the series by reporting team", () => {
      const grouped = calculateWorkAddedVsCompleted(
        scopedTasks,
        filterFor(dailyCase.range.start, dailyCase.range.end),
        context,
        "reportingTeam",
      );

      const expected = dailyCase.grouped?.reportingTeam ?? {};
      expect(Object.keys(grouped)).toEqual(Object.keys(expected));
      for (const [key, figure] of Object.entries(expected)) {
        expectFigureMatchesReference(
          grouped[key] as MetricResult<WorkAddedCompletedSeries>,
          figure,
          dailyCase,
        );
      }
    });

    it("splits the series by portfolio and attributes a multi-portfolio task to each portfolio", () => {
      const portfolioTask = (
        gid: string,
        portfolioGids: readonly string[],
      ): WorkAddedCompletedTask => ({
        gid,
        assigneeGid: "1200000000000020",
        projectGids: ["1200000000000100"],
        createdAt: "2026-07-02T00:00:00.000Z" as ISODateTime,
        completedAt: null,
        dueAt: null,
        priorityOptionId: "high",
        estimatedMinutes: 30,
        portfolioGids,
      });

      const grouped = calculateWorkAddedVsCompleted(
        [
          portfolioTask("9999999999990001", ["1200000000000030"]),
          portfolioTask("9999999999990002", [
            "1200000000000030",
            "1200000000000031",
          ]),
          portfolioTask("9999999999990003", []),
        ],
        filterFor(dailyCase.range.start, dailyCase.range.end),
        context,
        "portfolio",
      );

      expect(Object.keys(grouped)).toEqual([
        "1200000000000030",
        "1200000000000031",
        UNASSIGNED_GROUP_KEY,
      ]);
      const createdOn = (key: string): number | undefined =>
        grouped[key]?.series.buckets.find(
          (bucket) => bucket.bucketStart === "2026-07-02",
        )?.createdCount;
      expect(createdOn("1200000000000030")).toBe(2);
      expect(createdOn("1200000000000031")).toBe(1);
      expect(createdOn(UNASSIGNED_GROUP_KEY)).toBe(1);
    });

    it("applies the user's own filters to the task list before the scans", () => {
      const result = calculateWorkAddedVsCompleted(
        scopedTasks,
        {
          ...filterFor(dailyCase.range.start, dailyCase.range.end),
          assigneeGids: ["1200000000000020"],
        },
        context,
      );

      const created = result.series.buckets.reduce(
        (sum, bucket) => sum + bucket.createdCount,
        0,
      );
      expect(created).toBe(2);
      expect(result.population.total).toBe(2);
    });
  });

  describe("deduplication (FR-036 / Shared Output Rule 1)", () => {
    it("counts a task that belongs to two projects exactly once", () => {
      const multiProjectTask = scopedTasks.find(
        (task) => task.gid === "1200000000000200",
      );
      expect(multiProjectTask?.projectGids).toHaveLength(2);

      const result = calculateWorkAddedVsCompleted(
        scopedTasks,
        filterFor(dailyCase.range.start, dailyCase.range.end),
        context,
      );

      const created = result.series.buckets.reduce(
        (sum, bucket) => sum + bucket.createdCount,
        0,
      );
      expect(created).toBe(4);
      expect(contributingMap(result)["created:2026-07-01"]).toEqual([
        "1200000000000200",
      ]);
    });

    it("counts a duplicated task row exactly once", () => {
      const duplicated = [
        ...scopedTasks,
        scopedTasks[0] as WorkAddedCompletedTask,
      ];

      const result = calculateWorkAddedVsCompleted(
        duplicated,
        filterFor(dailyCase.range.start, dailyCase.range.end),
        context,
      );

      expectFigureMatchesReference(result, dailyCase.ungrouped, dailyCase);
    });
  });

  describe("independent created and completed scans (FR-056 / FR-057)", () => {
    const outOfRangeTask = (
      gid: string,
      createdAt: string,
      completedAt: string | null,
    ): WorkAddedCompletedTask => ({
      gid,
      assigneeGid: "1200000000000020",
      projectGids: ["1200000000000100"],
      createdAt: createdAt as ISODateTime,
      completedAt: (completedAt ?? null) as ISODateTime | null,
      dueAt: null,
      priorityOptionId: "high",
      estimatedMinutes: 60,
    });

    it("counts a task created in the range but completed outside it only as added", () => {
      const result = calculateWorkAddedVsCompleted(
        [
          outOfRangeTask(
            "9999999999990010",
            "2026-07-05T00:00:00.000Z",
            "2026-08-05T00:00:00.000Z",
          ),
        ],
        filterFor(dailyCase.range.start, dailyCase.range.end),
        context,
      );

      const created = result.series.buckets.reduce(
        (sum, b) => sum + b.createdCount,
        0,
      );
      const completed = result.series.buckets.reduce(
        (sum, b) => sum + b.completedCount,
        0,
      );
      expect(created).toBe(1);
      expect(completed).toBe(0);
    });

    it("counts a task completed in the range but created outside it only as completed", () => {
      const result = calculateWorkAddedVsCompleted(
        [
          outOfRangeTask(
            "9999999999990011",
            "2026-05-05T00:00:00.000Z",
            "2026-07-20T00:00:00.000Z",
          ),
        ],
        filterFor(dailyCase.range.start, dailyCase.range.end),
        context,
      );

      const created = result.series.buckets.reduce(
        (sum, b) => sum + b.createdCount,
        0,
      );
      const completed = result.series.buckets.reduce(
        (sum, b) => sum + b.completedCount,
        0,
      );
      expect(created).toBe(0);
      expect(completed).toBe(1);
    });
  });

  describe("missing-value disclosure (FR-058 / Shared Output Rule 3)", () => {
    it("leaves unestimated tasks out of the effort sums and discloses the count", () => {
      const result = calculateWorkAddedVsCompleted(
        scopedTasks,
        filterFor(dailyCase.range.start, dailyCase.range.end),
        context,
      );

      expect(result.series.createdUnestimatedCount).toBe(1);
      expect(result.series.completedUnestimatedCount).toBe(1);
      expect(result.population.excluded).toEqual([
        { reason: "no_estimate_created", count: 1 },
        { reason: "no_estimate_completed", count: 1 },
      ]);
      expect(result.population.total).toBe(4);
    });
  });

  describe("drill-down parity (FR-062 / Shared Output Rule 5)", () => {
    it("reproduces a bucket's displayed figures from its contributing tasks", () => {
      const result = calculateWorkAddedVsCompleted(
        scopedTasks,
        filterFor(dailyCase.range.start, dailyCase.range.end),
        context,
      );

      const bucket = result.series.buckets.find(
        (b) => b.bucketStart === "2026-07-01",
      );
      expect(bucket).toBeDefined();

      assertDrillDownMatchesSummary(
        {
          label: "created:2026-07-01",
          displayedCount: bucket?.createdCount ?? 0,
          displayedEffortMinutes: bucket?.createdEffortMinutes ?? 0,
          contributingGids: contributingMap(result)["created:2026-07-01"] ?? [],
        },
        scopedTasks,
        reaggregate("created", "2026-07-01", "2026-07-01"),
      );
    });

    it("reproduces a grouped figure's displayed figures from its contributing tasks", () => {
      const grouped = calculateWorkAddedVsCompleted(
        scopedTasks,
        filterFor(dailyCase.range.start, dailyCase.range.end),
        context,
        "project",
      );

      const group = grouped[
        "1200000000000100"
      ] as MetricResult<WorkAddedCompletedSeries>;
      const bucket = group.series.buckets.find(
        (b) => b.bucketStart === "2026-07-05",
      );
      expect(bucket).toBeDefined();

      assertDrillDownMatchesSummary(
        {
          label: "project 1200000000000100 created:2026-07-05",
          displayedCount: bucket?.createdCount ?? 0,
          displayedEffortMinutes: bucket?.createdEffortMinutes ?? 0,
          contributingGids: contributingMap(group)["created:2026-07-05"] ?? [],
        },
        scopedTasks,
        reaggregate("created", "2026-07-05", "2026-07-05"),
      );
    });
  });

  describe("the reporting period", () => {
    it("refuses to report without a selected date range", () => {
      expect(() =>
        calculateWorkAddedVsCompleted(scopedTasks, {}, context),
      ).toThrow(/filter.dateRange is required/);
    });
  });

  describe("bucket auto-sizing (FR-059)", () => {
    it("uses daily buckets for a range of at most 45 days and weekly buckets beyond", () => {
      const daily = calculateWorkAddedVsCompleted(
        scopedTasks,
        filterFor("2026-06-01", "2026-07-15"),
        context,
      );
      expect(daily.series.buckets).toHaveLength(45);
      for (const bucket of daily.series.buckets) {
        expect(bucket.bucketStart).toBe(bucket.bucketEnd);
      }

      const weekly = calculateWorkAddedVsCompleted(
        scopedTasks,
        filterFor("2026-06-01", "2026-07-16"),
        context,
      );
      expect(weekly.series.buckets).toHaveLength(7);
      for (const bucket of weekly.series.buckets) {
        const start = new Date(`${bucket.bucketStart}T00:00:00.000Z`);
        const end = new Date(`${bucket.bucketEnd}T00:00:00.000Z`);
        expect(start.getUTCDay()).toBe(1);
        expect(end.getTime() - start.getTime()).toBe(6 * 86_400_000);
      }
    });
  });
});
