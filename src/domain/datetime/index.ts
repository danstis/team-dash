/**
 * `src/domain/datetime` — pure date/time helpers for the Asana Team
 * Performance & Workload Dashboard.
 *
 * Implements the FR-029..034 time/date contract plus the date-range preset
 * resolution required by FR-032 and the date-bucket width selection
 * required by `contracts/metrics-engine.md` (P1 — Work Added / Work
 * Completed, FR-059).
 *
 * Spec coverage
 * -------------
 * - FR-029: default to the browser's local timezone, with a UTC toggle.
 * - FR-030: apply the selected timezone consistently to chart buckets,
 *   range boundaries, due-date interpretation, snapshot-day boundaries,
 *   and displayed timestamps.
 * - FR-031: weeks start on Monday wherever a weekly bucket or
 *   "this/last week" preset is used.
 * - FR-032: date-range presets — this/last week, last 30 days,
 *   this/last month, this quarter (custom ranges are user-entered and
 *   flow through `FilterCriteria.dateRange` directly, so no preset
 *   resolution is required for them).
 * - FR-033: the date basis (creation / completion / due / etc.) is a
 *   caller concern; these helpers only resolve the calendar arithmetic
 *   under the active basis.
 * - FR-034: switching local ↔ UTC is a pure recomputation — the same
 *   `Date` instant produces a different `ISODate` under the new basis,
 *   never a blended answer.
 * - `contracts/metrics-engine.md`: bucket width auto-selected from the
 *   range length, deterministic, documented in code (see
 *   `DAILY_BUCKET_THRESHOLD_DAYS`).
 *
 * Boundary
 * --------
 * This file lives under `src/domain/**`, so it MUST stay
 * presentation-free, browser-free, and network-free per Constitution
 * Principle VI and the `eslint-plugin-boundaries` rule in
 * `eslint.config.js`. The only external API it relies on is the platform
 * `Date` and `Intl.DateTimeFormat` — both standard ECMAScript, neither
 * a network nor a React surface. No `process.env` is read; local-timezone
 * behaviour is resolved through `Intl.DateTimeFormat().resolvedOptions()
 * .timeZone`, which respects the host's `TZ` environment variable and
 * lets tests pin a deterministic local timezone for assertions.
 *
 * Pure helpers
 * ------------
 * Every exported function takes the active timezone basis explicitly and
 * returns a fresh value; nothing mutates its inputs and nothing reads
 * wall-clock state other than through the `now` argument passed in by
 * the caller. `MetricContext.now` (data-model.md) supplies that argument
 * in production so a metric run is reproducible from its inputs.
 */

/* -------------------------------------------------------------------------- */
/* Re-exports                                                                 */
/* -------------------------------------------------------------------------- */

export type {
  ISODate,
  ISODateTime,
  DateRange,
  DateRangePreset,
  TimezoneSetting,
  WeekStart,
} from "../types";

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Auto-bucket threshold (FR-059 / `contracts/metrics-engine.md`):
 * ranges whose inclusive day count is `<= DAILY_BUCKET_THRESHOLD_DAYS`
 * are bucketed by day; longer ranges switch to weekly buckets. The
 * threshold is fixed and exported so callers, tests, and documentation
 * can reference a single source of truth.
 *
 * Choosing 45 days keeps daily buckets legible across the standard
 * presets (`this_month` is ≤ 31 days, `last_month` ≤ 31 days, `last_30_days`
 * is exactly 30 days) while weekly buckets handle `this_quarter` (~90
 * days) without producing per-day bars that crowd the chart axis.
 */
export const DAILY_BUCKET_THRESHOLD_DAYS = 45;

/**
 * The fixed first day of an ISO week per FR-031. Held as a literal so the
 * calendar-arithmetic helpers and any future locale-agnostic refactor
 * share one definition.
 */
export const WEEK_START_DAY = 1 as const; // 1 = Monday in `Date.getUTCDay()`/`getDay()`

/* -------------------------------------------------------------------------- */
/* Local types                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The auto-selected bucket width (FR-059). A `'day'` bucket has
 * `bucketStart === bucketEnd`; a `'week'` bucket spans Monday..Sunday.
 */
export type BucketWidth = "day" | "week";

/**
 * One time bucket in a chart series. `bucketStart` and `bucketEnd` are
 * inclusive calendar dates (FR-059: "each independently").
 */
export interface DateBucket {
  bucketStart: ISODate;
  bucketEnd: ISODate;
}

/* -------------------------------------------------------------------------- */
/* Internal: timezone-aware formatting                                         */
/* -------------------------------------------------------------------------- */

/**
 * Returns the IANA timezone identifier to use for `'local'` mode. Uses
 * `Intl.DateTimeFormat().resolvedOptions().timeZone`, which respects the
 * `TZ` environment variable on POSIX hosts and so is deterministic in
 * tests that pin `process.env.TZ` at load time.
 */
function getLocalTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Returns the IANA timezone identifier to use for a given
 * `TimezoneSetting`. For `'utc'` this is always `'UTC'`; for `'local'`
 * it is the host's resolved timezone, which makes the function
 * deterministic across hosts that have a fixed `TZ` setting and across
 * tests that pin one.
 */
function resolveTimezoneId(timezone: TimezoneSetting): string {
  return timezone === "utc" ? "UTC" : getLocalTimeZone();
}

/**
 * Formats a calendar date (`year`, `month`, `day`) as an `ISODate`
 * (`YYYY-MM-DD`). Values are zero-padded — months/days below 10 gain a
 * leading `'0'` so the result is lexicographically sortable.
 */
function formatIsoDate(year: number, month: number, day: number): ISODate {
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}` as ISODate;
}

/**
 * Extracts the calendar `(year, month, day)` of `date` under the given
 * timezone by formatting with `Intl.DateTimeFormat` and parsing the
 * `YYYY-MM-DD` portion of the result. The `'en-CA'` locale is the only
 * built-in locale that emits `YYYY-MM-DD` for `dateStyle: 'short'`, so
 * parsing is locale-agnostic and stays deterministic.
 */
function getCalendarDateInTimezone(
  date: Date,
  timezone: TimezoneSetting,
): { year: number; month: number; day: number } {
  const id = resolveTimezoneId(timezone);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: id,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const lookup: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      lookup[part.type] = part.value;
    }
  }
  const year = Number(lookup.year);
  const month = Number(lookup.month);
  const day = Number(lookup.day);
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day)
  ) {
    throw new Error(
      `getCalendarDateInTimezone: invalid formatted parts for ${date.toISOString()} @ ${id}`,
    );
  }
  return { year, month, day };
}

/**
 * Formats `date` as an `ISODateTime` (`YYYY-MM-DDTHH:mm:ss.sss+HH:MM`)
 * under the given timezone. We use `Intl.DateTimeFormat` with the
 * requested timezone for the calendar fields, then reconstruct an
 * offset string from `formatToParts` so the wire form encodes the
 * *instant* unambiguously and round-trips through
 * `isoDateTimeToDate` exactly.
 */
function getCalendarDateTimeInTimezone(
  date: Date,
  timezone: TimezoneSetting,
): ISODateTime {
  const id = resolveTimezoneId(timezone);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: id,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    fractionalSecondDigits: 3,
  });
  const parts = formatter.formatToParts(date);
  const lookup: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      lookup[part.type] = part.value;
    }
  }
  // `Intl` can return `"24"` for hour at midnight in some platforms —
  // normalise to `"00"`.
  const hour = lookup.hour === "24" ? "00" : lookup.hour;
  // UTC is emitted with the canonical `Z` suffix per ISO-8601 / RFC 3339;
  // any other timezone uses the explicit `±HH:MM` offset so the wire form
  // round-trips losslessly through `new Date(...)`.
  const offset = timezone === "utc" ? "Z" : getTimezoneOffsetString(date, id);
  const iso = `${lookup.year}-${lookup.month}-${lookup.day}T${hour}:${lookup.minute}:${lookup.second}.${lookup.fractionalSecond ?? "000"}${offset}`;
  return iso as ISODateTime;
}

/**
 * Returns the `±HH:MM` offset string for the given IANA timezone at
 * the given instant. Computed via `Intl.DateTimeFormat` with
 * `timeZoneName: 'longOffset'` (e.g. `"GMT+11:00"`) and reduced to
 * `±HH:MM`. UTC produces `"+00:00"` so the wire form is unambiguous.
 */
function getTimezoneOffsetString(date: Date, timezoneId: string): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezoneId,
    timeZoneName: "longOffset",
  });
  const parts = formatter.formatToParts(date);
  const offsetPart = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  // offsetPart looks like "GMT+11:00", "GMT-05:00", or "GMT" (for UTC).
  const match = /GMT([+-]\d{2}:?\d{2})?/.exec(offsetPart);
  if (!match) {
    throw new Error(
      `getTimezoneOffsetString: unable to parse offset from "${offsetPart}"`,
    );
  }
  if (!match[1]) {
    return "+00:00";
  }
  const raw = match[1];
  // Normalise "+1100" → "+11:00" if needed.
  if (raw.includes(":")) {
    return raw.startsWith("+") || raw.startsWith("-") ? raw : `+${raw}`;
  }
  return `${raw.slice(0, 3)}:${raw.slice(3)}`;
}

/* -------------------------------------------------------------------------- */
/* Calendar date extraction                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Returns the calendar `ISODate` of `date` evaluated under `timezone`
 * (FR-029/FR-030). The returned string is timezone-free; downstream
 * code consumes it as a calendar-day identifier.
 */
export function toIsoDate(date: Date, timezone: TimezoneSetting): ISODate {
  const { year, month, day } = getCalendarDateInTimezone(date, timezone);
  return formatIsoDate(year, month, day);
}

/**
 * Returns the full `ISODateTime` of `date` evaluated under `timezone`.
 * The wire form carries the offset so `isoDateTimeToDate` can
 * round-trip the exact instant — and the calendar-date extraction
 * from this value via `toIsoDate` stays consistent with the basis.
 */
export function toIsoDateTime(
  date: Date,
  timezone: TimezoneSetting,
): ISODateTime {
  return getCalendarDateTimeInTimezone(date, timezone);
}

/**
 * Convenience: extract the calendar `ISODate` from an arbitrary
 * "now"-shaped input without separately passing the basis.
 */
export function nowAsIsoDate(now: Date, timezone: TimezoneSetting): ISODate {
  return toIsoDate(now, timezone);
}

/**
 * Convenience: extract the full `ISODateTime` of `now` under `timezone`.
 */
export function nowAsIsoDateTime(
  now: Date,
  timezone: TimezoneSetting,
): ISODateTime {
  return toIsoDateTime(now, timezone);
}

/* -------------------------------------------------------------------------- */
/* Wire-format conversion                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Serialises a `Date` to its UTC `ISODateTime` wire form
 * (`YYYY-MM-DDTHH:mm:ss.sssZ`). This is the canonical IndexedDB/JSON
 * representation: timezone-independent, comparable by string sort,
 * and round-trippable through `isoDateTimeToDate`.
 */
export function dateToIsoDateTime(date: Date): ISODateTime {
  return date.toISOString() as ISODateTime;
}

/**
 * Inverse of `dateToIsoDateTime`. Accepts an `ISODateTime` carrying
 * either a `Z` (UTC) suffix or a `±HH:MM` offset produced by
 * `toIsoDateTime`; the underlying `Date` constructor handles both.
 */
export function isoDateTimeToDate(value: ISODateTime): Date {
  return new Date(value);
}

/* -------------------------------------------------------------------------- */
/* ISO date arithmetic                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Parses an `ISODate` (`YYYY-MM-DD`) into a `(year, month, day)` triple
 * where `month` is 1-based (matching the `Intl.DateTimeFormat` parts
 * shape used elsewhere in this file).
 */
function parseIsoDate(value: ISODate): {
  year: number;
  month: number;
  day: number;
} {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new Error(`parseIsoDate: invalid ISODate "${value}"`);
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

/**
 * Builds a `Date` at UTC midnight for the given calendar date. Used by
 * pure date-arithmetic helpers so they never read the host's local
 * timezone and stay deterministic regardless of `TZ`.
 */
function isoDateToUtcDate(value: ISODate): Date {
  const { year, month, day } = parseIsoDate(value);
  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * Returns the `ISODate` `days` calendar days from `date`. Negative
 * `days` moves backwards. Crossing month/year/leap-day boundaries is
 * delegated to the underlying `Date` arithmetic, which honours the
 * calendar correctly.
 */
export function addDays(date: ISODate, days: number): ISODate {
  const base = isoDateToUtcDate(date);
  base.setUTCDate(base.getUTCDate() + days);
  const y = base.getUTCFullYear();
  const m = base.getUTCMonth() + 1;
  const d = base.getUTCDate();
  return formatIsoDate(y, m, d);
}

/**
 * Returns the inclusive day count from `start` to `end`:
 * `diffInDaysInclusive(d, d) === 1` and
 * `diffInDaysInclusive(d, addDays(d, 1)) === 2`. An inverted range
 * (`end < start`) is treated as an empty closed interval and yields
 * `0` — the caller is responsible for passing a valid range. Callers
 * that need a sign-preserving diff can compute
 * `diffInDaysInclusive(a, b) - diffInDaysInclusive(b, a)` or use the
 * surrounding range-check helpers above.
 */
export function diffInDaysInclusive(start: ISODate, end: ISODate): number {
  const startMs = isoDateToUtcDate(start).getTime();
  const endMs = isoDateToUtcDate(end).getTime();
  const days = Math.round((endMs - startMs) / 86_400_000);
  if (days < 0) {
    return 0;
  }
  return days + 1;
}

/* -------------------------------------------------------------------------- */
/* Range membership                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Returns `true` if `value` falls inside the closed interval
 * `[range.start, range.end]`. Accepts any of `ISODate`,
 * `ISODateTime`, or `Date`; the comparison is performed on the
 * calendar date under `timezone` for `ISODateTime` / `Date` inputs so
 * a time-of-day difference does not affect membership (FR-030).
 */
export function isDateInRange(
  value: ISODate | ISODateTime | Date,
  range: { start: ISODate; end: ISODate },
  timezone: TimezoneSetting = "local",
): boolean {
  const candidate = toIsoDate(toComparableDate(value), timezone);
  return candidate >= range.start && candidate <= range.end;
}

function toComparableDate(
  value: ISODate | ISODateTime | Date,
): Date {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return isoDateToUtcDate(value as ISODate);
    }
    return new Date(value);
  }
  throw new Error(`toComparableDate: unsupported value ${String(value)}`);
}

/* -------------------------------------------------------------------------- */
/* Week / month / quarter boundaries (FR-031, FR-032)                         */
/* -------------------------------------------------------------------------- */

/**
 * Calendar-date helpers below share a single primitive: take the
 * `(year, month, day)` triple in the requested timezone, then build the
 * start/end of the containing week/month/quarter under that calendar
 * (a pure UTC computation, since the triple is timezone-independent).
 */

function buildIsoDate(year: number, month: number, day: number): ISODate {
  return formatIsoDate(year, month, day);
}

/**
 * Monday of the ISO week containing `value` (FR-031, fixed week start).
 * Accepts any of `ISODate`, `ISODateTime`, or `Date`; the calendar
 * date is extracted under `timezone` first.
 */
export function startOfWeekInTimezone(
  value: ISODate | ISODateTime | Date,
  timezone: TimezoneSetting,
): ISODate {
  const comparable = toComparableDate(value);
  const { year, month, day } = getCalendarDateInTimezone(comparable, timezone);
  // `new Date(Date.UTC(y, m-1, d)).getUTCDay()` returns 0 for Sunday and
  // 1 for Monday, so the offset to Monday is `(getUTCDay() + 6) % 7`.
  const utc = new Date(Date.UTC(year, month - 1, day));
  const offset = (utc.getUTCDay() + 6) % 7;
  utc.setUTCDate(utc.getUTCDate() - offset);
  return buildIsoDate(
    utc.getUTCFullYear(),
    utc.getUTCMonth() + 1,
    utc.getUTCDate(),
  );
}

/**
 * Sunday of the ISO week containing `value` (FR-031).
 */
export function endOfWeekInTimezone(
  value: ISODate | ISODateTime | Date,
  timezone: TimezoneSetting,
): ISODate {
  const monday = startOfWeekInTimezone(value, timezone);
  return addDays(monday, 6);
}

/**
 * First day of the calendar month containing `value` under `timezone`.
 */
export function startOfMonthInTimezone(
  value: ISODate | ISODateTime | Date,
  timezone: TimezoneSetting,
): ISODate {
  const comparable = toComparableDate(value);
  const { year, month } = getCalendarDateInTimezone(comparable, timezone);
  return buildIsoDate(year, month, 1);
}

/**
 * Last day of the calendar month containing `value` under `timezone`.
 */
export function endOfMonthInTimezone(
  value: ISODate | ISODateTime | Date,
  timezone: TimezoneSetting,
): ISODate {
  const start = startOfMonthInTimezone(value, timezone);
  // Day 0 of the next month is the last day of the current month in
  // `Date` arithmetic — leap-year safe (Feb 2024 → 29, Feb 2025 → 28).
  return addDays(start, daysInMonth(start) - 1);
}

function daysInMonth(date: ISODate): number {
  const { year, month } = parseIsoDate(date);
  // Day 0 of (month + 1) collapses to the last day of `month`.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * First day of the calendar quarter containing `value` under
 * `timezone`. Quarters are calendar-aligned: Q1 = Jan–Mar, Q2 =
 * Apr–Jun, Q3 = Jul–Sep, Q4 = Oct–Dec.
 */
export function startOfQuarterInTimezone(
  value: ISODate | ISODateTime | Date,
  timezone: TimezoneSetting,
): ISODate {
  const comparable = toComparableDate(value);
  const { year, month } = getCalendarDateInTimezone(comparable, timezone);
  const quarterStartMonth = month - ((month - 1) % 3);
  return buildIsoDate(year, quarterStartMonth, 1);
}

/**
 * Last day of the calendar quarter containing `value` under
 * `timezone`.
 */
export function endOfQuarterInTimezone(
  value: ISODate | ISODateTime | Date,
  timezone: TimezoneSetting,
): ISODate {
  const start = startOfQuarterInTimezone(value, timezone);
  return addDays(start, daysInQuarter(start) - 1);
}

function daysInQuarter(date: ISODate): number {
  const { year, month } = parseIsoDate(date);
  const quarterStartMonth = month - ((month - 1) % 3);
  const nextQuarterStart = new Date(Date.UTC(year, quarterStartMonth + 2, 1));
  return Math.round(
    (nextQuarterStart.getTime() -
      new Date(Date.UTC(year, quarterStartMonth - 1, 1)).getTime()) /
      86_400_000,
  );
}

/* -------------------------------------------------------------------------- */
/* Date-range preset resolution (FR-032)                                       */
/* -------------------------------------------------------------------------- */

/**
 * Resolves a `DateRangePreset` to a concrete `{ start, end }` pair of
 * `ISODate` values evaluated under `timezone` (FR-029, FR-030, FR-031,
 * FR-032). The anchor is the supplied `now` instant — production
 * callers pass `MetricContext.now` (data-model.md) so the resolution is
 * reproducible from the metric's inputs.
 *
 * Each branch is expressed in terms of the boundary helpers above
 * (Monday week-start, month/quarter boundaries) plus a fixed 30-day
 * offset for `last_30_days`, so the same `now` instant under a
 * different `timezone` produces a *different* answer where the
 * underlying calendar date differs (FR-034: recalculation under the
 * newly selected basis, not blending).
 */
export function resolveDateRangePreset(
  preset:
    | "this_week"
    | "last_week"
    | "last_30_days"
    | "this_month"
    | "last_month"
    | "this_quarter",
  now: Date,
  timezone: TimezoneSetting,
): { start: ISODate; end: ISODate } {
  switch (preset) {
    case "this_week":
      return {
        start: startOfWeekInTimezone(now, timezone),
        end: endOfWeekInTimezone(now, timezone),
      };
    case "last_week": {
      const thisWeekStart = startOfWeekInTimezone(now, timezone);
      const lastWeekStart = addDays(thisWeekStart, -7);
      return {
        start: lastWeekStart,
        end: addDays(lastWeekStart, 6),
      };
    }
    case "last_30_days": {
      const end = toIsoDate(now, timezone);
      const start = addDays(end, -29);
      return { start, end };
    }
    case "this_month":
      return {
        start: startOfMonthInTimezone(now, timezone),
        end: endOfMonthInTimezone(now, timezone),
      };
    case "last_month": {
      const thisMonthStart = startOfMonthInTimezone(now, timezone);
      const lastMonthEnd = addDays(thisMonthStart, -1);
      return {
        start: startOfMonthInTimezone(lastMonthEnd, timezone),
        end: lastMonthEnd,
      };
    }
    case "this_quarter":
      return {
        start: startOfQuarterInTimezone(now, timezone),
        end: endOfQuarterInTimezone(now, timezone),
      };
    default: {
      // Exhaustiveness check: a future preset added to the union will
      // surface here at compile time, never at runtime.
      const _exhaustive: never = preset;
      throw new Error(
        `resolveDateRangePreset: unhandled preset "${String(_exhaustive)}"`,
      );
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Bucket width selection (FR-059)                                            */
/* -------------------------------------------------------------------------- */

/**
 * Auto-selects a bucket width from the inclusive day count of a range.
 * The threshold is `DAILY_BUCKET_THRESHOLD_DAYS` (45) and is exposed
 * for documentation and tests; see the constant's JSDoc for rationale.
 */
export function selectBucketWidth(rangeDays: number): BucketWidth {
  if (!Number.isFinite(rangeDays)) {
    throw new Error(
      `selectBucketWidth: rangeDays must be a finite number, got ${String(rangeDays)}`,
    );
  }
  return rangeDays <= DAILY_BUCKET_THRESHOLD_DAYS ? "day" : "week";
}

/**
 * Generates the bucket sequence for a chart series (FR-059:
 * `contracts/metrics-engine.md`). Daily buckets have
 * `bucketStart === bucketEnd`; weekly buckets span the Monday..
 * Sunday range of their ISO week and snap *backwards* to the previous
 * Monday even when the range start lies mid-week, so every bucket
 * lines up with the Monday week-start defined in FR-031. Bucket
 * boundaries are timezone-free (the caller has already resolved the
 * range under the active basis).
 */
export function generateBuckets(
  range: { start: ISODate; end: ISODate },
  width: BucketWidth,
): DateBucket[] {
  if (range.start > range.end) {
    throw new Error(
      `generateBuckets: start (${range.start}) must be <= end (${range.end})`,
    );
  }
  if (width === "day") {
    const buckets: DateBucket[] = [];
    let cursor = range.start;
    while (cursor <= range.end) {
      buckets.push({ bucketStart: cursor, bucketEnd: cursor });
      cursor = addDays(cursor, 1);
    }
    return buckets;
  }
  // Weekly buckets: walk in 7-day steps from the first Monday on or
  // before `range.start`.
  const firstMonday = previousOrSameMonday(range.start);
  const buckets: DateBucket[] = [];
  let cursor: ISODate = firstMonday;
  while (cursor <= range.end) {
    const bucketEnd = addDays(cursor, 6);
    buckets.push({ bucketStart: cursor, bucketEnd });
    cursor = addDays(cursor, 7);
  }
  return buckets;
}

function previousOrSameMonday(date: ISODate): ISODate {
  const { year, month, day } = parseIsoDate(date);
  const utc = new Date(Date.UTC(year, month - 1, day));
  const offset = (utc.getUTCDay() + 6) % 7;
  if (offset === 0) {
    return date;
  }
  return addDays(date, -offset);
}
