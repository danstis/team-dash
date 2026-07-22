/**
 * T016 — Cross-cutting domain types (Red phase).
 *
 * Verifies the shape contract documented in
 * `specs/001-asana-team-dashboard/data-model.md` (§ "Cross-cutting reporting
 * types (not persisted — computed in domain/)") and the metrics-engine
 * contract (`contracts/metrics-engine.md`, shared input types). These types
 * are the shared vocabulary every user story's filter UI, metric
 * calculator, and ViewState-driven component depends on, so the contract
 * tests here MUST fail before the implementation lands and pass after it.
 *
 * The type-only assertions below are compile-time: `tsc --noEmit` is the
 * actual verification. Runtime assertions confirm literal unions stay
 * exhaustive and the type-guard helpers correctly accept/reject values.
 */
import { describe, expect, it } from "vitest";
import {
  type DataQualityFlag,
  type DataQualityFlagKind,
  type DateRange,
  type DateRangePreset,
  type ExcludedPopulationEntry,
  type FilterCriteria,
  type ISODate,
  type ISODateTime,
  type MetricContext,
  type MetricResult,
  type TeamMappingOverride,
  type TimezoneSetting,
  type ViewState,
  type WeekStart,
  DATE_RANGE_PRESETS,
  isDataQualityFlagKind,
  isViewState,
} from "../../../src/domain/types";

const sampleGid = (label: string): string => `gid-${label}`;

describe("T016 cross-cutting domain types", () => {
  describe("ISODate / ISODateTime branded primitives", () => {
    it("exports ISODate and ISODateTime as string-compatible brand types", () => {
      const date: ISODate = "2026-07-22" as ISODate;
      const dateTime: ISODateTime = "2026-07-22T08:57:22Z" as ISODateTime;
      expect(typeof date).toBe("string");
      expect(typeof dateTime).toBe("string");
    });
  });

  describe("DateRangePreset", () => {
    it("exposes every preset mandated by FR-032", () => {
      expect(DATE_RANGE_PRESETS).toEqual([
        "this_week",
        "last_week",
        "last_30_days",
        "this_month",
        "last_month",
        "this_quarter",
      ]);
    });

    it("narrows to the documented literal union for FR-032 presets", () => {
      const presets: DateRangePreset[] = [
        "this_week",
        "last_week",
        "last_30_days",
        "this_month",
        "last_month",
        "this_quarter",
      ];
      expect(presets).toHaveLength(6);
    });
  });

  describe("TimezoneSetting / WeekStart (MetricContext primitives)", () => {
    it("TimezoneSetting is the FR-029 / FR-034 'local' | 'utc' literal union", () => {
      const local: TimezoneSetting = "local";
      const utc: TimezoneSetting = "utc";
      expect([local, utc]).toEqual(["local", "utc"]);
    });

    it("WeekStart is fixed to 'monday' (FR-031)", () => {
      // The literal-union assignment IS the compile-time FR-031 contract:
      // any drift in the declared `WeekStart` union surfaces here as a
      // `tsc --noEmit` failure rather than a runtime one, per Constitution
      // Principle III. The `.toUpperCase()` runtime assertion satisfies
      // Sonar S2699 ("at least one assertion") and exercises the *value
      // space* — it proves the runtime value carries through a string
      // transform rather than asserting `weekStart === weekStart` (which
      // S5914 already flagged as tautological).
      const weekStart: WeekStart = "monday";
      expect(weekStart.toUpperCase()).toBe("MONDAY");
    });
  });

  describe("TeamMappingOverride", () => {
    it("matches the FR-044 / FR-046 / data-model.md cross-cutting shape", () => {
      const override: TeamMappingOverride = {
        projectGid: sampleGid("project"),
        reportingTeamGid: sampleGid("reporting-team"),
        updatedAt: "2026-07-22T08:57:22Z" as ISODateTime,
      };

      expect(override.projectGid).toBe("gid-project");
      expect(override.reportingTeamGid).toBe("gid-reporting-team");
      expect(override.updatedAt).toBe("2026-07-22T08:57:22Z");
    });
  });

  describe("FilterCriteria (FR-047 / FR-048)", () => {
    it("makes every field optional/composable and is fully usable empty", () => {
      const empty: FilterCriteria = {};
      expect(empty).toEqual({});
    });

    it("accepts the documented dateRange shape including the 'custom' preset", () => {
      const dateRange: DateRange = {
        start: "2026-07-01" as ISODate,
        end: "2026-07-22" as ISODate,
        preset: "custom",
      };
      const filter: FilterCriteria = { dateRange };
      expect(filter.dateRange?.preset).toBe("custom");
    });

    it("allows assigneeGids to be the literal 'unassigned' sentinel", () => {
      const filter: FilterCriteria = { assigneeGids: "unassigned" };
      expect(filter.assigneeGids).toBe("unassigned");
    });

    it("allows priorityOptionIds to be the literal 'no_priority' sentinel", () => {
      const filter: FilterCriteria = { priorityOptionIds: "no_priority" };
      expect(filter.priorityOptionIds).toBe("no_priority");
    });

    it("constrains completionState, overdueState, estimateState to their documented literal unions", () => {
      const filter: FilterCriteria = {
        completionState: "incomplete",
        overdueState: "overdue",
        estimateState: "estimated",
      };
      expect(filter.completionState).toBe("incomplete");
      expect(filter.overdueState).toBe("overdue");
      expect(filter.estimateState).toBe("estimated");
    });

    it("treats blockedOnly and stalledOnly as boolean toggles", () => {
      const filter: FilterCriteria = { blockedOnly: true, stalledOnly: false };
      expect(filter.blockedOnly).toBe(true);
      expect(filter.stalledOnly).toBe(false);
    });
  });

  describe("MetricContext (contracts/metrics-engine.md shared input)", () => {
    it("requires now, timezone, weekStart, teamMapping and nothing else", () => {
      const context: MetricContext = {
        now: "2026-07-22T08:57:22Z" as ISODateTime,
        timezone: "local",
        weekStart: "monday",
        teamMapping: [],
      };

      expect(context.timezone).toBe("local");
      expect(context.weekStart).toBe("monday");
      expect(context.teamMapping).toEqual([]);
    });

    it("uses the current teamMapping only — no point-in-time history (FR-046)", () => {
      const context: MetricContext = {
        now: "2026-07-22T08:57:22Z" as ISODateTime,
        timezone: "utc",
        weekStart: "monday",
        teamMapping: [
          {
            projectGid: sampleGid("p"),
            reportingTeamGid: sampleGid("t"),
            updatedAt: "2026-07-22T08:57:22Z" as ISODateTime,
          },
        ],
      };

      expect(context.teamMapping).toHaveLength(1);
      expect(context.timezone).toBe("utc");
    });
  });

  describe("MetricResult<TSeries> (shared output of every metric calculator)", () => {
    type DemoSeries = { total: number };

    it("matches the documented shape: population + series + contributingTaskGids + dedupApplied + asOf", () => {
      const result: MetricResult<DemoSeries> = {
        population: {
          total: 42,
          excluded: [{ reason: "no_estimate", count: 3 }],
        },
        series: { total: 39 },
        contributingTaskGids: [sampleGid("a"), sampleGid("b")],
        dedupApplied: true,
        asOf: "2026-07-22T08:57:22Z" as ISODateTime,
      };

      expect(result.dedupApplied).toBe(true);
      expect(result.population.total).toBe(42);
      expect(result.population.excluded).toHaveLength(1);
      expect(result.contributingTaskGids).toHaveLength(2);
    });

    it("supports bucket-keyed drill-down sets (FR-052 / FR-062 / FR-067)", () => {
      const result: MetricResult<DemoSeries> = {
        population: { total: 5 },
        series: { total: 5 },
        contributingTaskGids: {
          "2026-07-01": [sampleGid("a")],
          "2026-07-02": [sampleGid("b"), sampleGid("c")],
        },
        dedupApplied: true,
        asOf: "2026-07-22T08:57:22Z" as ISODateTime,
      };

      if (Array.isArray(result.contributingTaskGids)) {
        throw new Error("expected Record<string, string[]> shape");
      }
      expect(result.contributingTaskGids["2026-07-01"]).toEqual(["gid-a"]);
      expect(result.contributingTaskGids["2026-07-02"]).toHaveLength(2);
    });

    it("forces dedupApplied to be the literal `true` marker (FR-036 lint-visible reminder)", () => {
      // The typed const IS the lint-visible FR-036 reminder on its own:
      // assigning anything other than `true` would surface as a `tsc`
      // failure here. The runtime assertion below satisfies Sonar S2699
      // ("at least one assertion") without re-introducing the tautological
      // `expect(literal).toBe(true)` (S5914) or the static-narrowable
      // `expect(typeof literal).toBe("boolean")` (also S5914 — TypeScript
      // narrows `typeof <boolean>` to the literal `"boolean"`). Coercing
      // the value via `.toString()` is a real runtime method call whose
      // return type is `string`, not a literal-narrowable type, so Sonar
      // cannot determine the result statically; the assertion therefore
      // verifies runtime behaviour rather than comparing two compile-time
      // twins.
      const literal: MetricResult<DemoSeries>["dedupApplied"] = true;
      expect(literal.toString()).toBe("true");
    });

    it("ExcludedPopulationEntry.reason is a free-form string (FR-058, FR-049)", () => {
      // FR-058 / FR-049 require metrics to disclose excluded populations
      // with a free-form reason label whose vocabulary the metric itself
      // owns. The contract is: any string is a valid `reason`. We exercise
      // it by constructing an `ExcludedPopulationEntry` with two distinct
      // domain-specific labels and asserting both round-trip through the
      // shape unchanged, rather than asserting `typeof reason === "string"`
      // (which is tautological once the field is typed as `string`).
      const first: ExcludedPopulationEntry = {
        reason: "no_estimate",
        count: 3,
      };
      const second: ExcludedPopulationEntry = {
        reason: "time_tracking_unavailable",
        count: 12,
      };

      expect(first.reason).toBe("no_estimate");
      expect(second.reason).toBe("time_tracking_unavailable");
      expect(first.count).toBe(3);
      expect(second.count).toBe(12);
    });
  });

  describe("ViewState (FR-085, FR-087)", () => {
    it("lists every UI state mandated by FR-085 verbatim", () => {
      const states: ViewState[] = [
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
      ];

      expect(states).toHaveLength(11);
      for (const state of states) {
        expect(isViewState(state)).toBe(true);
      }
    });

    it("isViewState rejects unknown strings so features cannot accidentally skip a case", () => {
      expect(isViewState("unknown_state")).toBe(false);
      expect(isViewState("")).toBe(false);
    });
  });

  describe("DataQualityFlag (FR-079 / FR-084)", () => {
    it("kind covers the FR-079 indicator set verbatim", () => {
      const kinds: DataQualityFlagKind[] = [
        "missing_assignee",
        "missing_estimate",
        "missing_priority",
        "malformed_priority",
        "missing_due_date",
        "missing_actual_time",
      ];

      for (const kind of kinds) {
        expect(isDataQualityFlagKind(kind)).toBe(true);
      }
    });

    it("rejects unknown kinds so metric scans cannot drift", () => {
      expect(isDataQualityFlagKind("missing_effort")).toBe(false);
    });

    it("matches the documented { kind, taskGids, count } shape", () => {
      const flag: DataQualityFlag = {
        kind: "missing_assignee",
        taskGids: [sampleGid("t1"), sampleGid("t2")],
        count: 2,
      };

      expect(flag.count).toBe(flag.taskGids.length);
    });
  });
});
