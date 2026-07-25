import type { TimezoneSetting } from "../../domain/types";

const DEFAULT_MAXIMUM_FRACTION_DIGITS = 2;
const MAXIMUM_FRACTION_DIGITS = 20;
const MINUTES_PER_HOUR = 60;
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface DurationFormatOptions {
  maximumFractionDigits?: number;
}

type DateInput = string | Date;

interface NormalisedDate {
  date: Date;
  dateOnly: boolean;
}

export function formatDuration(
  minutes: number,
  options: DurationFormatOptions = {},
): string {
  if (!Number.isFinite(minutes)) {
    throw new TypeError("formatDuration requires a finite number of minutes");
  }

  const maximumFractionDigits =
    options.maximumFractionDigits ?? DEFAULT_MAXIMUM_FRACTION_DIGITS;
  assertMaximumFractionDigits(maximumFractionDigits);

  const absoluteMinutes = roundForDisplay(
    Math.abs(minutes),
    maximumFractionDigits,
  );
  const sign = minutes < 0 && absoluteMinutes !== 0 ? "-" : "";
  const numberFormatter = new Intl.NumberFormat("en-AU", {
    maximumFractionDigits,
  });

  if (absoluteMinutes < MINUTES_PER_HOUR) {
    return `${sign}${numberFormatter.format(absoluteMinutes)} min`;
  }

  const hours = Math.floor(absoluteMinutes / MINUTES_PER_HOUR);
  const remainingMinutes = roundForDisplay(
    absoluteMinutes - hours * MINUTES_PER_HOUR,
    maximumFractionDigits,
  );
  const formattedHours = `${sign}${numberFormatter.format(hours)} h`;

  if (remainingMinutes === 0) {
    return formattedHours;
  }

  return `${formattedHours} ${numberFormatter.format(remainingMinutes)} min`;
}

export function formatDate(
  value: DateInput,
  timezone: TimezoneSetting = "local",
): string {
  const normalised = normaliseDate(value);
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: normalised.dateOnly ? "UTC" : resolveTimezone(timezone),
  }).format(normalised.date);
}

export function formatDateTime(
  value: DateInput,
  timezone: TimezoneSetting = "local",
): string {
  const normalised = normaliseDate(value);
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: normalised.dateOnly ? "UTC" : resolveTimezone(timezone),
  }).format(normalised.date);
}

function assertMaximumFractionDigits(value: number): void {
  if (
    !Number.isInteger(value) ||
    value < 0 ||
    value > MAXIMUM_FRACTION_DIGITS
  ) {
    throw new RangeError(
      `maximumFractionDigits must be an integer from 0 to ${MAXIMUM_FRACTION_DIGITS}`,
    );
  }
}

function roundForDisplay(value: number, maximumFractionDigits: number): number {
  return Number(value.toFixed(maximumFractionDigits));
}

function normaliseDate(value: DateInput): NormalisedDate {
  if (value instanceof Date) {
    return { date: assertValidDate(value), dateOnly: false };
  }

  const dateOnlyMatch = DATE_ONLY_PATTERN.exec(value);
  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1]);
    const month = Number(dateOnlyMatch[2]);
    const day = Number(dateOnlyMatch[3]);
    const date = new Date(Date.UTC(year, month - 1, day));

    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      throw new TypeError(`Invalid date value: ${value}`);
    }

    return { date, dateOnly: true };
  }

  return { date: assertValidDate(new Date(value)), dateOnly: false };
}

function assertValidDate(value: Date): Date {
  if (Number.isNaN(value.getTime())) {
    throw new TypeError("Invalid date value");
  }

  return value;
}

function resolveTimezone(timezone: TimezoneSetting): string {
  return timezone === "utc"
    ? "UTC"
    : Intl.DateTimeFormat().resolvedOptions().timeZone;
}
