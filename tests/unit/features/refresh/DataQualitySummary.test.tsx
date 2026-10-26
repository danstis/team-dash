/**
 * Unit tests for `src/features/refresh/DataQualitySummary.tsx`.
 *
 * What this file pins
 * -------------------
 * The integration test `tests/integration/refresh/data-quality-summary.test.tsx`
 * exercises the FR-084 summary against a REAL `validation_error`
 * outcome — it drives the Asana client against an MSW fixture whose
 * task payload carries a malformed `Priority` custom field and asserts
 * that the surfaced counts come from the client's structured issues.
 * The two suites do complementary jobs:
 *
 * - Integration: the cross-boundary contract — the counts the summary
 *   renders are the counts the refresh's validation pass reported.
 * - Unit (this file): the leaf-component contract in isolation. The
 *   DOM attributes (`data-testid`, `data-issue-total`,
 *   `data-flag-kind`, `data-flag-count`, `data-drilldown-count`,
 *   `role`, `aria-live`, `aria-label`), the heading level, the copy
 *   for every flag kind, the zero state, and the drill-down
 *   hand-off — with no MSW, no Dexie, no providers. Coverage
 *   instrumentation picks this file up so SonarCloud can verify the
 *   FR-084 surface T064 ships has automated coverage (the integration
 *   job's coverage is not uploaded to the scanner).
 *
 * Scope and boundary
 * ------------------
 * The test imports only the component the row ships
 * (`DataQualitySummary`) and the React + testing-library surface it
 * needs to render. No `CredentialsProvider`, no `WorkspaceProvider`,
 * no MSW, no Dexie. The rendered DOM attributes are the contract
 * selectors the integration test pins; this file asserts the same
 * attributes so a future contributor who accidentally drops one of
 * them in a refactor fails BOTH suites.
 *
 * Determinism
 * -----------
 * The unit tests are fully deterministic: the component is synchronous
 * on first paint (no async init, no IndexedDB read, no network), so
 * every assertion is a plain render-and-assert. No network, no
 * IndexedDB, no MSW.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import type { DataQualityFlag } from "../../../../src/domain/types";
import { DataQualitySummary } from "../../../../src/features/refresh/DataQualitySummary";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Render the surface the way the dashboard chrome composes it. The
 * helper keeps the per-test bodies focused on the assertions.
 */
function renderSummary(props: {
  readonly flags: readonly DataQualityFlag[];
  readonly onSelectFlag?: (flag: DataQualityFlag) => void;
}): void {
  render(
    <StrictMode>
      <DataQualitySummary
        flags={props.flags}
        onSelectFlag={props.onSelectFlag}
      />
    </StrictMode>,
  );
}

/* -------------------------------------------------------------------------- */
/* The surface                                                                */
/* -------------------------------------------------------------------------- */

describe("DataQualitySummary", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the documented DOM contract", () => {
    renderSummary({
      flags: [{ kind: "missing_priority", taskGids: ["task-a"], count: 1 }],
    });

    const summary = screen.getByTestId("data-quality-summary");
    expect(summary.tagName).toBe("SECTION");
    expect(summary.getAttribute("role")).toBe("status");
    expect(summary.getAttribute("aria-live")).toBe("polite");
    expect(summary.getAttribute("aria-label")).toBe("Data quality summary");
    expect(summary.getAttribute("data-issue-total")).toBe("1");
    expect(summary.getAttribute("data-flag-count")).toBe("1");
  });

  it("renders the heading as <h2> so the surrounding chrome can own the document <h1>", () => {
    // The summary is composed INSIDE the dashboard chrome that owns the
    // document's <h1>. The component MUST therefore render its title as
    // <h2> — a future contributor who widens it to <h1> would skip a
    // heading level (WCAG 1.3.1).
    renderSummary({ flags: [] });
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      /data quality summary/i,
    );
  });

  it("labels every kind of data-completeness finding", () => {
    renderSummary({
      flags: [
        { kind: "missing_assignee", taskGids: ["task-a"], count: 1 },
        { kind: "missing_estimate", taskGids: ["task-b"], count: 1 },
        { kind: "missing_priority", taskGids: ["task-c"], count: 1 },
        { kind: "malformed_priority", taskGids: ["task-d"], count: 1 },
        { kind: "missing_due_date", taskGids: ["task-e"], count: 1 },
        { kind: "missing_actual_time", taskGids: ["task-f"], count: 1 },
      ],
    });

    const rows = screen.getAllByTestId("data-quality-flag");
    expect(rows).toHaveLength(6);

    const labels = rows.map((row) => row.textContent);
    expect(labels).toContain("Missing assignee: 1 task");
    expect(labels).toContain("Missing estimate: 1 task");
    expect(labels).toContain("Missing Priority: 1 task");
    expect(labels).toContain("Malformed Priority: 1 task");
    expect(labels).toContain("Missing due date: 1 task");
    expect(labels).toContain("Missing actual time: 1 task");
  });

  it("pluralises the affected-task count", () => {
    renderSummary({
      flags: [
        { kind: "missing_assignee", taskGids: ["task-a"], count: 1 },
        {
          kind: "missing_estimate",
          taskGids: ["task-b", "task-c"],
          count: 2,
        },
      ],
    });

    const rows = screen.getAllByTestId("data-quality-flag");
    expect(rows[0]).toHaveTextContent("Missing assignee: 1 task");
    expect(rows[1]).toHaveTextContent("Missing estimate: 2 tasks");
  });

  it("publishes the count and the drill-down size of every row", () => {
    renderSummary({
      flags: [
        {
          kind: "malformed_priority",
          taskGids: ["task-a", "task-b", "task-c"],
          count: 3,
        },
      ],
    });

    const row = screen.getByTestId("data-quality-flag");
    expect(row.getAttribute("data-flag-kind")).toBe("malformed_priority");
    expect(row.getAttribute("data-flag-count")).toBe("3");
    expect(row.getAttribute("data-drilldown-count")).toBe("3");
  });

  it("does not render a finding with no affected tasks", () => {
    renderSummary({
      flags: [
        { kind: "missing_due_date", taskGids: [], count: 0 },
        { kind: "missing_priority", taskGids: ["task-a"], count: 1 },
      ],
    });

    const rows = screen.getAllByTestId("data-quality-flag");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.getAttribute("data-flag-kind")).toBe("missing_priority");
    expect(
      screen
        .getByTestId("data-quality-summary")
        .getAttribute("data-flag-count"),
    ).toBe("1");
  });

  it("totals the findings across every kind", () => {
    renderSummary({
      flags: [
        { kind: "missing_assignee", taskGids: ["task-a"], count: 1 },
        {
          kind: "missing_estimate",
          taskGids: ["task-b", "task-c"],
          count: 2,
        },
        { kind: "missing_priority", taskGids: ["task-d"], count: 1 },
      ],
    });

    expect(
      screen
        .getByTestId("data-quality-summary")
        .getAttribute("data-issue-total"),
    ).toBe("4");
    expect(screen.getByTestId("data-quality-summary-total")).toHaveTextContent(
      /4 data-completeness issues were found in the most recent refresh/i,
    );
  });

  it("says so plainly when the most recent refresh found no issues", () => {
    renderSummary({ flags: [] });

    const summary = screen.getByTestId("data-quality-summary");
    expect(summary.getAttribute("data-issue-total")).toBe("0");
    expect(summary.getAttribute("data-flag-count")).toBe("0");
    expect(screen.getByTestId("data-quality-summary-total")).toHaveTextContent(
      /no data-completeness issues were found in the most recent refresh/i,
    );
    expect(screen.queryByTestId("data-quality-flag-list")).toBeNull();
  });

  it("never publishes a composite quality score", () => {
    // The constitution forbids "hidden or unexplained composite
    // performance scores". The summary discloses counts and the tasks
    // behind them — never a percentage or a grade.
    renderSummary({
      flags: [
        {
          kind: "missing_priority",
          taskGids: ["task-a", "task-b"],
          count: 2,
        },
      ],
    });

    expect(screen.getByTestId("data-quality-summary")).not.toHaveTextContent(
      /\d+\s*%/,
    );
    expect(screen.queryByTestId("data-quality-score")).toBeNull();
  });

  it("hands the whole flag back to the caller when a row is activated", () => {
    const selected: DataQualityFlag[] = [];
    const flag: DataQualityFlag = {
      kind: "malformed_priority",
      taskGids: ["task-a", "task-b"],
      count: 2,
    };

    renderSummary({
      flags: [flag],
      onSelectFlag: (clicked: DataQualityFlag) => {
        selected.push(clicked);
      },
    });

    const button = screen.getByTestId("data-quality-flag-button");
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveTextContent("Malformed Priority: 2 tasks");

    fireEvent.click(button);

    expect(selected).toHaveLength(1);
    expect(selected[0]).toBe(flag);
    expect(selected[0]?.taskGids).toEqual(["task-a", "task-b"]);
  });

  it("pluralises the affected-task count on a drill-down row too", () => {
    renderSummary({
      flags: [{ kind: "missing_priority", taskGids: ["task-a"], count: 1 }],
      onSelectFlag: () => {},
    });

    expect(screen.getByTestId("data-quality-flag-button")).toHaveTextContent(
      "Missing Priority: 1 task",
    );
  });

  it("renders static rows when no drill-down is wired", () => {
    renderSummary({
      flags: [{ kind: "missing_priority", taskGids: ["task-a"], count: 1 }],
    });

    expect(screen.getByTestId("data-quality-flag-label")).toHaveTextContent(
      "Missing Priority: 1 task",
    );
    expect(screen.queryByTestId("data-quality-flag-button")).toBeNull();
  });
});
