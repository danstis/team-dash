/**
 * BSOD-787 — unit tests for `src/features/dashboard/ReportingPeriodControl.tsx`.
 *
 * The control is the dashboard's own reporting-period selector. These
 * tests pin the surface in isolation: it offers the shared preset
 * vocabulary (FR-091), names the period in the reader's words (not raw
 * enum values — DESIGN.md › The Product Voice Rule), and reports the
 * preset the user picked.
 *
 * The end-to-end wiring — the control changing what the dashboard's
 * metric reports — is pinned by the integration suite in
 * `tests/integration/dashboard/dashboard-shell.test.tsx`.
 *
 * Boundary: no network, no IndexedDB, no credentials — the control is a
 * pure presentation layer over the state it is given.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReportingPeriodControl } from "../../../../src/features/dashboard/ReportingPeriodControl";
import { DATE_RANGE_PRESETS } from "../../../../src/domain/types";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** The period selector. */
function selector(): HTMLElement {
  return screen.getByRole("combobox", { name: "Reporting period" });
}

/* -------------------------------------------------------------------------- */
/* The control                                                                */
/* -------------------------------------------------------------------------- */

describe("ReportingPeriodControl — the dashboard's reporting period", () => {
  afterEach(() => {
    cleanup();
  });

  it("offers every preset of the shared vocabulary, named in plain words", () => {
    render(<ReportingPeriodControl value="last_90_days" onChange={vi.fn()} />);

    const options = Array.from(selector().querySelectorAll("option"));
    expect(options).toHaveLength(DATE_RANGE_PRESETS.length);
    expect(options.map((option) => option.getAttribute("value"))).toEqual([
      ...DATE_RANGE_PRESETS,
    ]);
    // The reader sees words, not enum values (DESIGN.md › The Product
    // Voice Rule).
    expect(options.map((option) => option.textContent)).toEqual([
      "This week",
      "Last week",
      "Last 30 days",
      "Last 90 days",
      "This month",
      "Last month",
      "This quarter",
      "Last quarter",
      "Last 6 months",
      "Last 12 months",
      "Last calendar year",
      "This year",
      "All time",
    ]);
  });

  it("shows the period in force", () => {
    render(<ReportingPeriodControl value="last_90_days" onChange={vi.fn()} />);
    expect(selector()).toHaveValue("last_90_days");
  });

  it("reports the preset the user picked", () => {
    const onChange = vi.fn();
    render(<ReportingPeriodControl value="last_90_days" onChange={onChange} />);

    fireEvent.change(selector(), { target: { value: "last_12_months" } });

    expect(onChange).toHaveBeenCalledWith("last_12_months");
  });

  it("ignores a value that is not a preset", () => {
    const onChange = vi.fn();
    render(<ReportingPeriodControl value="last_90_days" onChange={onChange} />);

    fireEvent.change(selector(), { target: { value: "not_a_preset" } });

    expect(onChange).not.toHaveBeenCalled();
  });
});
