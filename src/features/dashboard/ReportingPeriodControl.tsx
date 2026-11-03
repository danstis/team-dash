/**
 * `src/features/dashboard/ReportingPeriodControl.tsx` — the dashboard's
 * reporting-period selector.
 *
 * What this module owns
 * ---------------------
 * The one control that says which window the report covers. The metric
 * reports a period (FR-059) and the dashboard owns the period its users
 * see first (FR-092): the reader picks a preset from the shared
 * vocabulary and the masthead states the choice, so a screenshot of the
 * dashboard says what it covers (DESIGN.md › The Masthead Rule).
 *
 * The control holds no state of its own: it reports the preset the
 * reader picked and renders the one in force, exactly like the other
 * controlled surfaces in the app.
 *
 * The vocabulary
 * --------------
 * The options are the domain's `DATE_RANGE_PRESETS` — ONE list, shared
 * with the task list's date-range filter (FR-091). The labels are the
 * shared copy module's, so the same window is named the same way
 * everywhere (DESIGN.md › The Product Voice Rule).
 *
 * Boundary
 * --------
 * `src/features/dashboard/**` is the plan-documented home for the
 * reporting-dashboard React UI. This module imports the domain's
 * vocabulary and the shared labels; it performs no I/O and writes
 * nothing to storage.
 */
import type { ReactElement } from "react";

import { DATE_RANGE_PRESETS, type DateRangePreset } from "../../domain/types";
import { DATE_RANGE_PRESET_LABELS } from "../../shared/dateRangePresetLabels";

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The controlled props of the reporting-period selector.
 */
export interface ReportingPeriodControlProps {
  /** The period in force. */
  readonly value: DateRangePreset;
  /**
   * Called with the preset the reader picked. The control never changes
   * the period itself — the dashboard owns it.
   */
  readonly onChange: (preset: DateRangePreset) => void;
}

/* -------------------------------------------------------------------------- */
/* Component                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The reporting-period selector: a labelled list of the shared date-range
 * presets.
 */
export function ReportingPeriodControl({
  value,
  onChange,
}: Readonly<ReportingPeriodControlProps>): ReactElement {
  const handleChange = (chosen: string): void => {
    const preset = DATE_RANGE_PRESETS.find((candidate) => candidate === chosen);
    if (preset === undefined) {
      // A value outside the vocabulary names no period; ignoring it
      // leaves the period in force untouched.
      return;
    }
    onChange(preset);
  };

  return (
    <div className="td-dashboard__period">
      <label className="td-dashboard__period-label" htmlFor="reporting-period">
        Reporting period
      </label>
      <select
        id="reporting-period"
        className="td-dashboard__period-select"
        data-testid="reporting-period"
        value={value}
        onChange={(event): void => {
          handleChange(event.target.value);
        }}
      >
        {DATE_RANGE_PRESETS.map((preset) => (
          <option key={preset} value={preset}>
            {DATE_RANGE_PRESET_LABELS[preset]}
          </option>
        ))}
      </select>
    </div>
  );
}
