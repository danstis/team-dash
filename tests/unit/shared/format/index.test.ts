process.env.TZ = "Australia/Sydney";

import { beforeAll, describe, expect, it } from "vitest";
import {
  formatDate,
  formatDateTime,
  formatDuration,
} from "../../../../src/shared/format";

beforeAll(() => {
  process.env.TZ = "Australia/Sydney";
  expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(
    "Australia/Sydney",
  );
});

describe("T033 formatDuration", () => {
  it.each([
    [0, "0 min"],
    [1, "1 min"],
    [45, "45 min"],
    [60, "1 h"],
    [90, "1 h 30 min"],
    [120, "2 h"],
    [150.5, "2 h 30.5 min"],
    [2400, "40 h"],
  ])("formats %s minutes as %s", (minutes, expected) => {
    expect(formatDuration(minutes)).toBe(expected);
  });

  it("keeps fractional-minute precision configurable at the display boundary", () => {
    const minutes = 90.1234;
    const snapshot = minutes;

    expect(formatDuration(minutes)).toBe("1 h 30.12 min");
    expect(formatDuration(minutes, { maximumFractionDigits: 3 })).toBe(
      "1 h 30.123 min",
    );
    // Non-mutation guarantee (spec.md:600 "retaining internal precision"):
    // the caller-supplied minute count must be unchanged after formatting.
    expect(minutes === snapshot).toBe(true);
  });

  it("normalises display rounding across an hour boundary", () => {
    expect(formatDuration(59.999)).toBe("1 h");
  });

  it("preserves the sign for variance-style durations", () => {
    expect(formatDuration(-90.5)).toBe("-1 h 30.5 min");
    expect(formatDuration(-0.001)).toBe("0 min");
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects a non-finite duration: %s",
    (minutes) => {
      expect(() => formatDuration(minutes)).toThrow(TypeError);
    },
  );

  it.each([-1, 1.5, 21])(
    "rejects an unsupported maximumFractionDigits value: %s",
    (maximumFractionDigits) => {
      expect(() => formatDuration(1, { maximumFractionDigits })).toThrow(
        RangeError,
      );
    },
  );
});

describe("T033 formatDate", () => {
  it("formats an ISO calendar date in Australian English", () => {
    expect(formatDate("2026-03-18", "local")).toBe("18 Mar 2026");
    expect(formatDate("2026-03-18", "utc")).toBe("18 Mar 2026");
  });

  it("does not shift a date-only value across timezone boundaries", () => {
    expect(formatDate("2026-01-01", "local")).toBe("1 Jan 2026");
    expect(formatDate("2026-01-01", "utc")).toBe("1 Jan 2026");
  });

  it("recalculates an instant under the selected timezone basis", () => {
    const instant = "2026-03-18T13:30:00.000Z";

    expect(formatDate(instant, "utc")).toBe("18 Mar 2026");
    expect(formatDate(instant, "local")).toBe("19 Mar 2026");
  });

  it("accepts a Date without mutating it", () => {
    const value = new Date("2026-03-18T13:30:00.000Z");
    const timestamp = value.getTime();

    expect(formatDate(value, "utc")).toBe("18 Mar 2026");
    expect(value.getTime()).toBe(timestamp);
  });

  it("defaults to the local timezone basis", () => {
    expect(formatDate("2026-03-18T13:30:00.000Z")).toBe("19 Mar 2026");
  });

  it.each(["not-a-date", "2026-02-30", new Date(Number.NaN)])(
    "rejects an invalid date value: %s",
    (value) => {
      expect(() => formatDate(value)).toThrow(TypeError);
    },
  );
});

describe("T033 formatDateTime", () => {
  it("formats a UTC timestamp with a 24-hour clock", () => {
    expect(formatDateTime("2026-03-18T14:30:00.000Z", "utc")).toBe(
      "18 Mar 2026, 14:30",
    );
  });

  it("recalculates the date and time under the local timezone basis", () => {
    expect(formatDateTime("2026-03-18T14:30:00.000Z", "local")).toBe(
      "19 Mar 2026, 01:30",
    );
  });

  it("retains leading zeroes in 24-hour times", () => {
    expect(formatDateTime("2026-03-18T09:05:00.000Z", "utc")).toBe(
      "18 Mar 2026, 09:05",
    );
  });

  it("accepts a Date and defaults to the local timezone basis", () => {
    expect(formatDateTime(new Date("2026-03-18T14:30:00.000Z"))).toBe(
      "19 Mar 2026, 01:30",
    );
  });

  it.each(["not-a-date", "2026-02-30", new Date(Number.NaN)])(
    "rejects an invalid date-time value: %s",
    (value) => {
      expect(() => formatDateTime(value)).toThrow(TypeError);
    },
  );
});
