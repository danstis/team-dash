/**
 * `describeValue` — how a filter reads in the reader's words.
 *
 * The date-range value is the one that can leak a domain literal into
 * the UI: the all-time window carries the vocabulary's OPEN lower bound
 * (a comparison value, never a date the report walks), and a bound is
 * not something to print (FR-091). The active-filters summary already
 * guards it (`src/features/tasks/ActiveFiltersList.tsx`); the filter
 * bar's own pill needs the same treatment.
 */
import { describe, expect, it } from "vitest";

import {
  OPEN_DATE_RANGE_START,
  type FilterCriteria,
  type ISODate,
} from "../../../../src/domain/types";
import { describeValue } from "../../../../src/features/filters/filter-model";

const CONTEXT = { users: [], projects: [], timezone: "utc" } as const;

describe("describeValue — the date-range value", () => {
  it("names the all-time window, never the open bound it carries", () => {
    const criteria: FilterCriteria = {
      dateRange: {
        start: OPEN_DATE_RANGE_START,
        end: "2026-03-15" as ISODate,
        preset: "all_time",
      },
    };

    const value = describeValue(criteria, "dateRange", CONTEXT);

    expect(value).toBe("All time");
    expect(value).not.toContain("1000");
  });

  it("names a custom range by its own bounds", () => {
    const criteria: FilterCriteria = {
      dateRange: {
        start: "2026-02-01" as ISODate,
        end: "2026-03-15" as ISODate,
        preset: "custom",
      },
    };

    expect(describeValue(criteria, "dateRange", CONTEXT)).toBe(
      "1 Feb 2026 – 15 Mar 2026",
    );
  });

  it("names a preset window by the shared label", () => {
    const criteria: FilterCriteria = {
      dateRange: {
        start: "2026-01-15" as ISODate,
        end: "2026-03-15" as ISODate,
        preset: "last_90_days",
      },
    };

    expect(describeValue(criteria, "dateRange", CONTEXT)).toBe("Last 90 days");
  });
});
