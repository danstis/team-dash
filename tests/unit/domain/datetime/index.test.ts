/**
 * T020 — `src/domain/datetime` unit tests (Red phase for T018).
 *
 * Covers the FR-029..034 time/date contract the rest of the app relies on:
 *
 * - FR-029: default to browser local timezone, with a UTC toggle.
 * - FR-030: apply the selected timezone consistently to chart buckets,
 *   range boundaries, due-date interpretation, snapshot-day boundaries,
 *   and displayed timestamps.
 * - FR-031: weeks start on Monday wherever a weekly bucket or
 *   "this/last week" preset is used.
 * - FR-032: date-range presets (this/last week, last 30 days, this/last
 *   month, this quarter, plus custom).
 * - FR-034: switching local/UTC recalculates consistently — no mixing of
 *   bases between the old and new settings.
 * - `contracts/metrics-engine.md` P1 bucket-width rule: daily for ranges
 *   ≤ 45 days, weekly beyond (threshold fixed and documented in
 *   implementation).
 *
 * The tests MUST fail before `src/domain/datetime/index.ts` is implemented
 * and pass after it, per Constitution Principle III. The module lives under
 * `src/domain/**` and therefore stays presentation-free, browser-free, and
 * network-free (ESLint boundary rule, `eslint.config.js`).
 *
 * Determinism
 * ------------
 * Local-timezone behaviour depends on the host's `TZ` environment variable.
 * Tests that assert local-mode results set `process.env.TZ` to a fixed
 * IANA timezone (`Australia/Sydney`) at the top of the file so the same
 * assertions hold on every host. Vitest re-reads `process.env.TZ` per call
 * to `Intl.DateTimeFormat`, so changing it at module load time is enough.
 */
/* eslint-disable @typescript-eslint/no-unused-expressions */

process.env.TZ = "Australia/Sydney";

import { beforeAll, describe, expect, it } from "vitest";
import type {
  DateRangePreset,
  ISODate,
  ISODateTime,
  TimezoneSetting,
} from "../../../../src/domain/types";
import {
  DAILY_BUCKET_THRESHOLD_DAYS,
  addDays,
  dateToIsoDateTime,
  diffInDaysInclusive,
  endOfMonthInTimezone,
  endOfQuarterInTimezone,
  endOfWeekInTimezone,
  generateBuckets,
  isoDateTimeToDate,
  isDateInRange,
  nowAsIsoDate,
  nowAsIsoDateTime,
  resolveDateRangePreset,
  selectBucketWidth,
  startOfMonthInTimezone,
  startOfQuarterInTimezone,
  startOfWeekInTimezone,
  toIsoDate,
  toIsoDateTime,
} from "../../../../src/domain/datetime";

/* -------------------------------------------------------------------------- */
/* Local timezone test contract                                               */
/* -------------------------------------------------------------------------- */

/**
 * `Intl.DateTimeFormat().resolvedOptions().timeZone` is read lazily on
 * every call in modern Node, so overriding `process.env.TZ` at module load
 * time should be sufficient — but we assert it explicitly so a future Node
 * change (or a vitest runner isolation change) can't silently make the
 * local-mode assertions below meaningless.
 */
const LOCAL_TIMEZONE = "Australia/Sydney";

beforeAll(() => {
  process.env.TZ = LOCAL_TIMEZONE;
  expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(LOCAL_TIMEZONE);
});

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A fixed "now" used across the suite so preset/anchor math is
 * deterministic. 2026-03-18 14:30:00 Australia/Sydney is:
 * - Australia/Sydney (UTC+11 with DST): 2026-03-18T03:30:00Z
 * - UTC:                          2026-03-18T14:30:00Z
 * - Sydney calendar date:         2026-03-18
 * - ISO week:                     2026-W12 (Mon 2026-03-16 .. Sun 2026-03-22)
 * - Month:                        March 2026 (Q1)
 */
const FIXED_NOW_ISO = "2026-03-18T03:30:00.000Z";
const FIXED_NOW = new Date(FIXED_NOW_ISO);

/**
 * ISO week structure under Australia/Sydney for the anchor date:
 *
 *   Mon 2026-03-16
 *   Tue 2026-03-17
 *   Wed 2026-03-18  <- anchor (FIXED_NOW_ISO instant; 14:30 Sydney local)
 *   Thu 2026-03-19
 *   Fri 2026-03-20
 *   Sat 2026-03-21
 *   Sun 2026-03-22
 *
 * Last ISO week (W11):
 *   Mon 2026-03-09 .. Sun 2026-03-15
 */
const ANCHOR_SYDNEY_DATE = "2026-03-18" as ISODate;
const THIS_WEEK_START = "2026-03-16" as ISODate;
const THIS_WEEK_END = "2026-03-22" as ISODate;
const LAST_WEEK_START = "2026-03-09" as ISODate;
const LAST_WEEK_END = "2026-03-15" as ISODate;

const isoDate = (value: string): ISODate => value as ISODate;
const isoDateTime = (value: string): ISODateTime => value as ISODateTime;

/* -------------------------------------------------------------------------- */
/* timezone basis                                                             */
/* -------------------------------------------------------------------------- */

describe("T020 timezone basis (FR-029, FR-030, FR-034)", () => {
  describe("toIsoDate / toIsoDateTime", () => {
    it("returns the UTC calendar date when timezone='utc'", () => {
      // 2026-03-18T14:30:00Z is a UTC calendar date of 2026-03-18.
      const utc = new Date("2026-03-18T14:30:00.000Z");
      expect(toIsoDate(utc, "utc")).toBe(isoDate("2026-03-18"));
      expect(toIsoDateTime(utc, "utc")).toBe(
        isoDateTime("2026-03-18T14:30:00.000Z"),
      );
    });

    it("returns the local calendar date when timezone='local'", () => {
      // The same instant under Australia/Sydney (UTC+11 with DST):
      // 2026-03-18T03:30:00Z → 2026-03-18T14:30:00+11:00.
      // Calendar date in Sydney is still 2026-03-18.
      const instant = new Date("2026-03-18T03:30:00.000Z");
      expect(toIsoDate(instant, "local")).toBe(isoDate("2026-03-18"));
      expect(toIsoDateTime(instant, "local")).toBe(
        isoDateTime("2026-03-18T14:30:00.000+11:00"),
      );
    });

    it("rolls back the calendar date when UTC and local straddle midnight differently (FR-030)", () => {
      // 2026-03-18T13:30:00Z → in Sydney it's 2026-03-19T00:30:00 (next day),
      // but in UTC it's still 2026-03-18. Switching basis MUST change the
      // resulting date — never blend the two.
      const instant = new Date("2026-03-18T13:30:00.000Z");

      expect(toIsoDate(instant, "utc")).toBe(isoDate("2026-03-18"));
      expect(toIsoDate(instant, "local")).toBe(isoDate("2026-03-19"));
    });

    it("rolls back the calendar date the other way for an earlier Sydney instant (FR-030)", () => {
      // 2026-03-18T15:00:00Z → in Sydney that's 2026-03-19T02:00:00. The
      // UTC day is 2026-03-18; Sydney day is 2026-03-19. The opposite
      // direction proves the helpers are not assuming "local is always
      // ahead of UTC".
      const instant = new Date("2026-03-18T15:00:00.000Z");

      expect(toIsoDate(instant, "utc")).toBe(isoDate("2026-03-18"));
      expect(toIsoDate(instant, "local")).toBe(isoDate("2026-03-19"));
    });

    it("agrees across the day for instants in the early morning UTC that are still the previous Sydney day", () => {
      // 2026-03-17T18:00:00Z → 2026-03-18T05:00:00 Sydney → Sydney day
      // 2026-03-18; UTC day 2026-03-17. Confirms the helpers handle the
      // negative-offset direction correctly too (relevant if/when a
      // western-hemisphere local timezone is selected).
      const instant = new Date("2026-03-17T18:00:00.000Z");

      expect(toIsoDate(instant, "utc")).toBe(isoDate("2026-03-17"));
      expect(toIsoDate(instant, "local")).toBe(isoDate("2026-03-18"));
    });
  });

  describe("nowAsIsoDate / nowAsIsoDateTime", () => {
    it("returns the calendar date under the requested basis", () => {
      // FIXED_NOW is the same instant under either basis; only the
      // calendar date (year/month/day) needs to match.
      expect(toIsoDate(FIXED_NOW, "utc")).toBe(isoDate("2026-03-18"));
      expect(toIsoDate(FIXED_NOW, "local")).toBe(ANCHOR_SYDNEY_DATE);
    });

    it("nowAsIsoDateTime delegates to toIsoDateTime", () => {
      expect(nowAsIsoDateTime(FIXED_NOW, "utc")).toBe(
        isoDateTime("2026-03-18T03:30:00.000Z"),
      );
      expect(nowAsIsoDateTime(FIXED_NOW, "local")).toBe(
        isoDateTime("2026-03-18T14:30:00.000+11:00"),
      );
    });

    it("nowAsIsoDate wraps the result of nowAsIsoDateTime", () => {
      expect(nowAsIsoDate(FIXED_NOW, "utc")).toBe(isoDate("2026-03-18"));
      expect(nowAsIsoDate(FIXED_NOW, "local")).toBe(ANCHOR_SYDNEY_DATE);
    });
  });

  describe("dateToIsoDateTime / isoDateTimeToDate round-trip", () => {
    it("round-trips an arbitrary Date under the UTC basis", () => {
      const original = new Date("2026-03-18T14:30:00.000Z");
      const wire = dateToIsoDateTime(original);
      const restored = isoDateTimeToDate(wire);
      expect(restored.getTime()).toBe(original.getTime());
      expect(wire).toBe(isoDateTime("2026-03-18T14:30:00.000Z"));
    });

    it("round-trips an arbitrary Date under the local basis", () => {
      const original = new Date("2026-03-18T03:30:00.000Z");
      const wire = dateToIsoDateTime(original);
      const restored = isoDateTimeToDate(wire);
      expect(restored.getTime()).toBe(original.getTime());
      // Wire form must be in UTC-Z (FR-090, spec: ISO-8601 serialised);
      // timezone-specific display formatting is a separate concern of
      // the presentation layer.
      expect(wire).toBe(isoDateTime("2026-03-18T03:30:00.000Z"));
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Monday week-start (FR-031)                                                  */
/* -------------------------------------------------------------------------- */

describe("T020 Monday week-start (FR-031)", () => {
  // We test under both timezone bases because the helpers must agree with
  // whichever basis the user has currently selected — FR-030.
  const TIMEZONES: TimezoneSetting[] = ["utc", "local"];

  for (const timezone of TIMEZONES) {
    describe(`under timezone=${timezone}`, () => {
      it("returns the same date for a Monday", () => {
        expect(
          startOfWeekInTimezone(new Date("2026-03-16T12:00:00Z"), timezone),
        ).toBe(isoDate("2026-03-16"));
      });

      it("returns the same date for a Tuesday (in the same week)", () => {
        expect(
          startOfWeekInTimezone(new Date("2026-03-17T12:00:00Z"), timezone),
        ).toBe(isoDate("2026-03-16"));
      });

      it("returns the same date for a Wednesday (anchor day)", () => {
        expect(
          startOfWeekInTimezone(new Date("2026-03-18T12:00:00Z"), timezone),
        ).toBe(isoDate("2026-03-16"));
      });

      it("returns the same date for a Sunday (still in the same week)", () => {
        expect(
          startOfWeekInTimezone(new Date("2026-03-22T12:00:00Z"), timezone),
        ).toBe(isoDate("2026-03-16"));
      });

      it("returns the previous Monday when given a Sunday one week later", () => {
        expect(
          startOfWeekInTimezone(new Date("2026-03-29T12:00:00Z"), timezone),
        ).toBe(isoDate("2026-03-23"));
      });

      it("endOfWeekInTimezone returns the Sunday of the same ISO week", () => {
        expect(
          endOfWeekInTimezone(new Date("2026-03-18T12:00:00Z"), timezone),
        ).toBe(isoDate("2026-03-22"));
      });

      it("endOfWeekInTimezone returns the Sunday of the same ISO week as the Monday input", () => {
        // The ISO week containing Monday 2026-03-16 runs through
        // Sunday 2026-03-22 (FR-031: Monday week-start). A Monday input
        // therefore maps to that week's end, not the prior Sunday.
        expect(
          endOfWeekInTimezone(new Date("2026-03-16T12:00:00Z"), timezone),
        ).toBe(isoDate("2026-03-22"));
      });

      it("startOfWeek and endOfWeek produce a Monday..Sunday pair covering exactly 7 days", () => {
        const start = startOfWeekInTimezone(
          new Date("2026-03-18T12:00:00Z"),
          timezone,
        );
        const end = endOfWeekInTimezone(
          new Date("2026-03-18T12:00:00Z"),
          timezone,
        );
        expect(diffInDaysInclusive(start, end)).toBe(7);
      });
    });
  }

  it("switches the week-start answer when local and UTC straddle the Sunday→Monday boundary (FR-030, FR-034)", () => {
    // 2026-03-22T14:00:00Z is:
    //   - 2026-03-22 (Sunday) in UTC        → week starts Monday 2026-03-16
    //   - 2026-03-23T01:00 (Monday) in Sydney → week starts Monday 2026-03-23
    // The same instant therefore produces a DIFFERENT week-start under the
    // two bases — exactly what FR-034's "no mixing of bases" guarantee
    // requires the helper to honour.
    const sydneyMondayUtcSunday = new Date("2026-03-22T14:00:00.000Z");
    expect(startOfWeekInTimezone(sydneyMondayUtcSunday, "utc")).toBe(
      isoDate("2026-03-16"),
    );
    expect(startOfWeekInTimezone(sydneyMondayUtcSunday, "local")).toBe(
      isoDate("2026-03-23"),
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Month / quarter boundaries                                                  */
/* -------------------------------------------------------------------------- */

describe("T020 month/quarter boundaries (used by FR-032 presets)", () => {
  it("startOfMonthInTimezone returns the first day of the local month", () => {
    expect(
      startOfMonthInTimezone(new Date("2026-03-18T03:30:00.000Z"), "local"),
    ).toBe(isoDate("2026-03-01"));
    expect(
      startOfMonthInTimezone(new Date("2026-03-18T14:30:00.000Z"), "utc"),
    ).toBe(isoDate("2026-03-01"));
  });

  it("endOfMonthInTimezone returns the last day of the local month", () => {
    expect(
      endOfMonthInTimezone(new Date("2026-03-18T03:30:00.000Z"), "local"),
    ).toBe(isoDate("2026-03-31"));
  });

  it("endOfMonthInTimezone handles 28/29/30/31-day months correctly", () => {
    expect(
      endOfMonthInTimezone(new Date("2026-02-15T00:00:00.000Z"), "utc"),
    ).toBe(isoDate("2026-02-28"));
    // 2024 is a leap year (divisible by 4, not by 100).
    expect(
      endOfMonthInTimezone(new Date("2024-02-15T00:00:00.000Z"), "utc"),
    ).toBe(isoDate("2024-02-29"));
    expect(
      endOfMonthInTimezone(new Date("2026-04-15T00:00:00.000Z"), "utc"),
    ).toBe(isoDate("2026-04-30"));
    expect(
      endOfMonthInTimezone(new Date("2026-05-15T00:00:00.000Z"), "utc"),
    ).toBe(isoDate("2026-05-31"));
  });

  it("startOfQuarterInTimezone returns the first day of the calendar quarter", () => {
    // 2026-03-18 sits in Q1 → quarter start is January 1.
    expect(
      startOfQuarterInTimezone(
        new Date("2026-03-18T03:30:00.000Z"),
        "local",
      ),
    ).toBe(isoDate("2026-01-01"));
    expect(
      startOfQuarterInTimezone(
        new Date("2026-08-18T03:30:00.000Z"),
        "local",
      ),
    ).toBe(isoDate("2026-07-01"));
  });

  it("endOfQuarterInTimezone returns the last day of the calendar quarter", () => {
    expect(
      endOfQuarterInTimezone(new Date("2026-03-18T03:30:00.000Z"), "local"),
    ).toBe(isoDate("2026-03-31"));
    expect(
      endOfQuarterInTimezone(new Date("2026-08-18T03:30:00.000Z"), "local"),
    ).toBe(isoDate("2026-09-30"));
  });
});

/* -------------------------------------------------------------------------- */
/* Date arithmetic                                                             */
/* -------------------------------------------------------------------------- */

describe("T020 date arithmetic", () => {
  describe("addDays", () => {
    it("adds positive day counts", () => {
      expect(addDays(isoDate("2026-03-18"), 1)).toBe(isoDate("2026-03-19"));
      expect(addDays(isoDate("2026-03-18"), 7)).toBe(isoDate("2026-03-25"));
    });

    it("subtracts when given a negative day count", () => {
      expect(addDays(isoDate("2026-03-18"), -1)).toBe(isoDate("2026-03-17"));
      expect(addDays(isoDate("2026-03-01"), -1)).toBe(isoDate("2026-02-28"));
    });

    it("crosses month and year boundaries", () => {
      expect(addDays(isoDate("2026-01-31"), 1)).toBe(isoDate("2026-02-01"));
      expect(addDays(isoDate("2025-12-31"), 1)).toBe(isoDate("2026-01-01"));
      expect(addDays(isoDate("2024-02-28"), 1)).toBe(isoDate("2024-02-29"));
    });

    it("handles zero correctly", () => {
      expect(addDays(isoDate("2026-03-18"), 0)).toBe(isoDate("2026-03-18"));
    });
  });

  describe("diffInDaysInclusive", () => {
    it("returns 1 for the same date", () => {
      expect(diffInDaysInclusive(isoDate("2026-03-18"), isoDate("2026-03-18"))).toBe(
        1,
      );
    });

    it("returns the inclusive day count between two dates", () => {
      expect(diffInDaysInclusive(isoDate("2026-03-18"), isoDate("2026-03-19"))).toBe(
        2,
      );
      expect(diffInDaysInclusive(isoDate("2026-03-18"), isoDate("2026-03-25"))).toBe(
        8,
      );
    });

    it("returns 0 when the interval is empty (end < start)", () => {
      // The function counts days in the closed interval [start, end];
      // an inverted range is an empty interval and yields 0 — the
      // caller is responsible for passing a valid (start <= end) range.
      expect(diffInDaysInclusive(isoDate("2026-03-19"), isoDate("2026-03-18"))).toBe(
        0,
      );
    });

    it("crosses month and year boundaries correctly", () => {
      expect(diffInDaysInclusive(isoDate("2026-01-31"), isoDate("2026-02-01"))).toBe(
        2,
      );
      expect(diffInDaysInclusive(isoDate("2025-12-31"), isoDate("2026-01-01"))).toBe(
        2,
      );
    });
  });

  describe("isDateInRange", () => {
    const range = {
      start: isoDate("2026-03-10"),
      end: isoDate("2026-03-20"),
    };

    it("includes the start and end dates (closed interval)", () => {
      expect(isDateInRange(isoDate("2026-03-10"), range)).toBe(true);
      expect(isDateInRange(isoDate("2026-03-20"), range)).toBe(true);
    });

    it("includes dates strictly inside the range", () => {
      expect(isDateInRange(isoDate("2026-03-15"), range)).toBe(true);
    });

    it("excludes dates strictly outside the range", () => {
      expect(isDateInRange(isoDate("2026-03-09"), range)).toBe(false);
      expect(isDateInRange(isoDate("2026-03-21"), range)).toBe(false);
    });

    it("accepts ISODateTime inputs and compares by calendar date under the basis", () => {
      // ISODateTime is converted to a calendar date under the chosen basis
      // before comparison, so a time-only difference does not affect range
      // membership.
      expect(
        isDateInRange(isoDateTime("2026-03-15T23:59:00Z"), range, "utc"),
      ).toBe(true);
      expect(
        isDateInRange(isoDateTime("2026-03-15T13:00:00Z"), range, "local"),
      ).toBe(true);
    });

    it("accepts Date inputs and compares by calendar date under the basis", () => {
      expect(isDateInRange(new Date("2026-03-15T12:00:00Z"), range)).toBe(true);
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Date-range preset resolution (FR-032)                                       */
/* -------------------------------------------------------------------------- */

describe("T020 date-range preset resolution (FR-032, FR-031)", () => {
  describe("under timezone='local' (Australia/Sydney anchor)", () => {
    const timezone: TimezoneSetting = "local";

    it("this_week spans Monday..Sunday of the ISO week containing the anchor", () => {
      const range = resolveDateRangePreset(
        "this_week",
        FIXED_NOW,
        timezone,
      );
      expect(range).toEqual({
        start: THIS_WEEK_START,
        end: THIS_WEEK_END,
      });
    });

    it("last_week spans Monday..Sunday of the prior ISO week", () => {
      const range = resolveDateRangePreset(
        "last_week",
        FIXED_NOW,
        timezone,
      );
      expect(range).toEqual({
        start: LAST_WEEK_START,
        end: LAST_WEEK_END,
      });
    });

    it("last_30_days spans exactly the 30 calendar days ending on the anchor's local date", () => {
      const range = resolveDateRangePreset(
        "last_30_days",
        FIXED_NOW,
        timezone,
      );
      expect(range.start).toBe(isoDate("2026-02-17"));
      expect(range.end).toBe(isoDate("2026-03-18"));
      // Inclusive day count: 30 days.
      expect(diffInDaysInclusive(range.start, range.end)).toBe(30);
    });

    it("this_month spans the first..last day of the anchor's local month", () => {
      const range = resolveDateRangePreset(
        "this_month",
        FIXED_NOW,
        timezone,
      );
      expect(range).toEqual({
        start: isoDate("2026-03-01"),
        end: isoDate("2026-03-31"),
      });
    });

    it("last_month spans the first..last day of the prior local month", () => {
      const range = resolveDateRangePreset(
        "last_month",
        FIXED_NOW,
        timezone,
      );
      expect(range).toEqual({
        start: isoDate("2026-02-01"),
        end: isoDate("2026-02-28"),
      });
    });

    it("this_quarter spans the first..last day of the anchor's local calendar quarter (Q1)", () => {
      const range = resolveDateRangePreset(
        "this_quarter",
        FIXED_NOW,
        timezone,
      );
      expect(range).toEqual({
        start: isoDate("2026-01-01"),
        end: isoDate("2026-03-31"),
      });
    });
  });

  describe("under timezone='utc'", () => {
    const timezone: TimezoneSetting = "utc";

    it("this_week uses the UTC calendar week", () => {
      // FIXED_NOW at 14:30Z on 2026-03-18 (Wednesday) → week 2026-W12
      // (Mon 2026-03-16 .. Sun 2026-03-22).
      const range = resolveDateRangePreset(
        "this_week",
        FIXED_NOW,
        timezone,
      );
      expect(range).toEqual({
        start: isoDate("2026-03-16"),
        end: isoDate("2026-03-22"),
      });
    });

    it("this_month uses the UTC calendar month", () => {
      const range = resolveDateRangePreset(
        "this_month",
        FIXED_NOW,
        timezone,
      );
      expect(range).toEqual({
        start: isoDate("2026-03-01"),
        end: isoDate("2026-03-31"),
      });
    });

    it("last_30_days ends on the UTC calendar date of the anchor", () => {
      const range = resolveDateRangePreset(
        "last_30_days",
        FIXED_NOW,
        timezone,
      );
      expect(range.end).toBe(isoDate("2026-03-18"));
      expect(diffInDaysInclusive(range.start, range.end)).toBe(30);
    });
  });

  describe("all six presets produce start <= end and are inclusive", () => {
    const presets: DateRangePreset[] = [
      "this_week",
      "last_week",
      "last_30_days",
      "this_month",
      "last_month",
      "this_quarter",
    ];

    for (const preset of presets) {
      for (const timezone of ["local", "utc"] as const) {
        it(`${preset} @ ${timezone} has start <= end and includes both endpoints`, () => {
          const range = resolveDateRangePreset(preset, FIXED_NOW, timezone);
          // start <= end in lex order (YYYY-MM-DD).
          expect(range.start <= range.end).toBe(true);
          // Both endpoints are within their own range.
          expect(isDateInRange(range.start, range)).toBe(true);
          expect(isDateInRange(range.end, range)).toBe(true);
        });
      }
    }
  });

  describe("switching the basis recalculates consistently (FR-034)", () => {
    it("uses different day boundaries when local and UTC straddle midnight", () => {
      // 2026-03-18T13:30:00Z → local 2026-03-19 (Sydney), UTC 2026-03-18.
      // this_month must therefore pick March locally and March in UTC, but
      // last_30_days must end on a different day under the two bases.
      const instant = new Date("2026-03-18T13:30:00.000Z");

      const localRange = resolveDateRangePreset(
        "last_30_days",
        instant,
        "local",
      );
      const utcRange = resolveDateRangePreset(
        "last_30_days",
        instant,
        "utc",
      );

      expect(localRange.end).toBe(isoDate("2026-03-19"));
      expect(utcRange.end).toBe(isoDate("2026-03-18"));
      // Both still inclusive of exactly 30 calendar days.
      expect(diffInDaysInclusive(localRange.start, localRange.end)).toBe(30);
      expect(diffInDaysInclusive(utcRange.start, utcRange.end)).toBe(30);
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Bucket width selection (contracts/metrics-engine.md, FR-059)               */
/* -------------------------------------------------------------------------- */

describe("T020 date-bucket width selection (FR-059)", () => {
  it("exposes the documented threshold", () => {
    // Threshold MUST be a stable, code-documented number per FR-059
    // ("exact thresholds fixed at implementation, but MUST stay
    // deterministic and be documented in code").
    expect(DAILY_BUCKET_THRESHOLD_DAYS).toBe(45);
  });

  it("returns 'day' for a range of 1 day", () => {
    expect(selectBucketWidth(1)).toBe("day");
  });

  it("returns 'day' for a range of 30 days", () => {
    expect(selectBucketWidth(30)).toBe("day");
  });

  it("returns 'day' for the boundary value of 45 days (inclusive)", () => {
    expect(selectBucketWidth(45)).toBe("day");
  });

  it("returns 'week' for 46 days (just past the boundary)", () => {
    expect(selectBucketWidth(46)).toBe("week");
  });

  it("returns 'week' for a full year", () => {
    expect(selectBucketWidth(366)).toBe("week");
  });
});

/* -------------------------------------------------------------------------- */
/* Bucket generation (FR-059, contracts/metrics-engine.md)                    */
/* -------------------------------------------------------------------------- */

describe("T020 generateBuckets (FR-059)", () => {
  it("emits one bucket per day for a 5-day daily range", () => {
    const buckets = generateBuckets(
      { start: isoDate("2026-03-01"), end: isoDate("2026-03-05") },
      "day",
    );
    expect(buckets).toEqual([
      { bucketStart: isoDate("2026-03-01"), bucketEnd: isoDate("2026-03-01") },
      { bucketStart: isoDate("2026-03-02"), bucketEnd: isoDate("2026-03-02") },
      { bucketStart: isoDate("2026-03-03"), bucketEnd: isoDate("2026-03-03") },
      { bucketStart: isoDate("2026-03-04"), bucketEnd: isoDate("2026-03-04") },
      { bucketStart: isoDate("2026-03-05"), bucketEnd: isoDate("2026-03-05") },
    ]);
  });

  it("emits Monday..Sunday weekly buckets across a multi-week range", () => {
    // Anchor Monday..Sunday three weeks long, 2026-03-02 (Mon) .. 2026-03-22 (Sun)
    const buckets = generateBuckets(
      { start: isoDate("2026-03-02"), end: isoDate("2026-03-22") },
      "week",
    );
    expect(buckets).toEqual([
      { bucketStart: isoDate("2026-03-02"), bucketEnd: isoDate("2026-03-08") },
      { bucketStart: isoDate("2026-03-09"), bucketEnd: isoDate("2026-03-15") },
      { bucketStart: isoDate("2026-03-16"), bucketEnd: isoDate("2026-03-22") },
    ]);
  });

  it("emits a partial first/last weekly bucket when the range does not align to a Monday/Sunday", () => {
    // Range Wed 2026-03-04 .. Tue 2026-03-10. Under FR-031 (Monday week-start)
    // the first weekly bucket starts on the preceding Monday 2026-03-02 and
    // ends on Sunday 2026-03-08, even though 2026-03-02 lies outside the
    // requested range. This matches the "weekly bucket" semantics used by
    // `contracts/metrics-engine.md` and is the simplest deterministic rule.
    const buckets = generateBuckets(
      { start: isoDate("2026-03-04"), end: isoDate("2026-03-10") },
      "week",
    );
    expect(buckets).toEqual([
      { bucketStart: isoDate("2026-03-02"), bucketEnd: isoDate("2026-03-08") },
      { bucketStart: isoDate("2026-03-09"), bucketEnd: isoDate("2026-03-15") },
    ]);
  });

  it("emits exactly one bucket when start equals end under both widths", () => {
    const daily = generateBuckets(
      { start: isoDate("2026-03-18"), end: isoDate("2026-03-18") },
      "day",
    );
    expect(daily).toEqual([
      { bucketStart: isoDate("2026-03-18"), bucketEnd: isoDate("2026-03-18") },
    ]);
    const weekly = generateBuckets(
      { start: isoDate("2026-03-18"), end: isoDate("2026-03-18") },
      "week",
    );
    expect(weekly).toEqual([
      { bucketStart: isoDate("2026-03-16"), bucketEnd: isoDate("2026-03-22") },
    ]);
  });

  it("produces contiguous, non-overlapping buckets whose union covers the range", () => {
    const range = { start: isoDate("2026-03-01"), end: isoDate("2026-03-31") };
    const daily = generateBuckets(range, "day");
    expect(daily).toHaveLength(31);
    expect(daily[0]).toEqual({
      bucketStart: isoDate("2026-03-01"),
      bucketEnd: isoDate("2026-03-01"),
    });
    expect(daily[31 - 1]).toEqual({
      bucketStart: isoDate("2026-03-31"),
      bucketEnd: isoDate("2026-03-31"),
    });
    // Adjacent buckets touch (next start == previous end + 1 day).
    for (let i = 1; i < daily.length; i++) {
      const prev = daily[i - 1]!.bucketEnd;
      const next = daily[i]!.bucketStart;
      expect(addDays(prev, 1)).toBe(next);
    }
  });

  it("throws when start > end (invalid range)", () => {
    expect(() =>
      generateBuckets(
        { start: isoDate("2026-03-10"), end: isoDate("2026-03-05") },
        "day",
      ),
    ).toThrow();
  });
});
