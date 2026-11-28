/**
 * `src/shared/dateRangePresetLabels.ts` — the plain-English name of
 * every date-range preset.
 *
 * The preset vocabulary itself lives in the domain
 * (`DateRangePreset` / `DATE_RANGE_PRESETS` in `src/domain/types.ts`);
 * this module is only its copy. Keeping the labels in one shared place
 * means every surface that offers a date range — the dashboard's
 * reporting period and the task list's date-range filter — names the
 * same window the same way (FR-091), and no surface invents a label of
 * its own.
 *
 * The wording follows DESIGN.md › The Product Voice Rule: the reader
 * sees words ("Last 90 days"), never the raw enum value
 * (`last_90_days`).
 *
 * Boundary
 * --------
 * This module is presentation copy over a domain vocabulary: it imports
 * the domain's type, and nothing else. It holds no state and performs
 * no work.
 */
import type { DateRangePreset } from "../domain/types";

/**
 * The label of each preset, in the reader's words.
 */
export const DATE_RANGE_PRESET_LABELS: Readonly<
  Record<DateRangePreset, string>
> = {
  this_week: "This week",
  last_week: "Last week",
  last_30_days: "Last 30 days",
  last_90_days: "Last 90 days",
  this_month: "This month",
  last_month: "Last month",
  this_quarter: "This quarter",
  last_quarter: "Last quarter",
  last_6_months: "Last 6 months",
  last_12_months: "Last 12 months",
  last_calendar_year: "Last calendar year",
  this_year: "This year",
  all_time: "All time",
};

/**
 * The label of one preset. Every preset of the vocabulary has one, so
 * the lookup cannot miss.
 */
export function dateRangePresetLabel(preset: DateRangePreset): string {
  return DATE_RANGE_PRESET_LABELS[preset];
}
