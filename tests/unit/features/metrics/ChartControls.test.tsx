/**
 * Unit tests for `src/features/metrics/ChartControls.tsx`.
 *
 * These are the controls' own unit tests: they pin the surface in
 * isolation — the labels, the checked state, the reported change, the
 * custom options a caller may pass — without a dashboard around it.
 * The end-to-end wiring (the controls driving the real chart, the
 * backlog view's own dimensions, two toggles on one page) is pinned by
 * the integration suite in
 * `tests/integration/metrics/chart-controls.test.tsx`.
 *
 * The unit suite exists beside the integration suite because the
 * SonarCloud new-code coverage gate reads the `test:unit` and
 * `test:contract` lcov reports only; integration coverage does not
 * count towards it (same reason as the `WorkAddedCompletedChart` unit
 * suite).
 *
 * Boundary: no network, no IndexedDB, no credentials — the controls
 * are a pure presentation layer over the state they are given.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CountEffortToggle,
  GroupBySelector,
  type ChartGroupByOption,
} from "../../../../src/features/metrics/ChartControls";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** The count↔effort radio of the given view. */
function radioFor(view: "count" | "effort"): HTMLElement {
  return screen.getByRole("radio", {
    name: view === "count" ? "Items" : "Estimated effort",
  });
}

/** The grouping selector. */
function selector(): HTMLElement {
  return screen.getByRole("combobox", { name: "Group by" });
}

/* -------------------------------------------------------------------------- */
/* The count-effort toggle                                                    */
/* -------------------------------------------------------------------------- */

describe("ChartControls — the count-effort toggle", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the two views and marks the one in force", () => {
    render(<CountEffortToggle value="effort" onChange={vi.fn()} />);

    const group = screen.getByRole("group", { name: "Show" });
    expect(within(group).getAllByRole("radio")).toHaveLength(2);
    expect(radioFor("effort")).toBeChecked();
    expect(radioFor("count")).not.toBeChecked();
  });

  it("reports the view the user picked", () => {
    const onChange = vi.fn();
    render(<CountEffortToggle value="count" onChange={onChange} />);

    fireEvent.click(radioFor("effort"));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("effort");
  });

  it("takes the words the caller gives it", () => {
    render(
      <CountEffortToggle
        value="count"
        onChange={vi.fn()}
        legend="Measure"
        countLabel="Tasks"
        effortLabel="Estimated time"
      />,
    );

    expect(screen.getByRole("group", { name: "Measure" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Tasks" })).toBeChecked();
    expect(
      screen.getByRole("radio", { name: "Estimated time" }),
    ).not.toBeChecked();
  });

  it("names the radio group the way the caller names it", () => {
    render(
      <CountEffortToggle
        value="count"
        onChange={vi.fn()}
        name="backlog-view"
      />,
    );

    const names = screen
      .getAllByRole("radio")
      .map((radio) => radio.getAttribute("name"));
    expect(names).toEqual(["backlog-view", "backlog-view"]);
  });

  it("keeps two toggles in two radio groups", () => {
    render(
      <>
        <CountEffortToggle value="count" onChange={vi.fn()} />
        <CountEffortToggle value="effort" onChange={vi.fn()} />
      </>,
    );

    const names = new Set(
      screen
        .getAllByRole("radio")
        .map((radio) => radio.getAttribute("name") ?? ""),
    );
    expect(names.size).toBe(2);
  });

  it("greys itself out when it is disabled", () => {
    render(<CountEffortToggle value="count" onChange={vi.fn()} disabled />);

    const group = screen.getByRole("group", { name: "Show" });
    expect(group).toBeDisabled();
    expect(radioFor("count")).toBeDisabled();
  });
});

/* -------------------------------------------------------------------------- */
/* The grouping selector                                                       */
/* -------------------------------------------------------------------------- */

describe("ChartControls — the grouping selector", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the standard dimensions and marks the one in force", () => {
    render(<GroupBySelector value="reportingTeam" onChange={vi.fn()} />);

    const select = selector();
    expect(
      within(select)
        .getAllByRole("option")
        .map((option) => option.getAttribute("value")),
    ).toEqual([
      "",
      "assignee",
      "reportingTeam",
      "project",
      "portfolio",
      "priority",
    ]);
    expect(select).toHaveValue("reportingTeam");
  });

  it("reports the dimension the user picked", () => {
    const onChange = vi.fn();
    render(<GroupBySelector value="assignee" onChange={onChange} />);

    fireEvent.change(selector(), { target: { value: "priority" } });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("priority");
  });

  it("reports the workspace-level view as no dimension", () => {
    const onChange = vi.fn();
    render(<GroupBySelector value="assignee" onChange={onChange} />);

    fireEvent.change(selector(), { target: { value: "" } });

    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it("offers the caller's own dimensions", () => {
    type DeliveryGroupBy = "workspace" | "milestone" | "assignee";

    const missingOptions = (
      // @ts-expect-error Custom dimensions require their own option list.
      <GroupBySelector<DeliveryGroupBy> value="workspace" onChange={vi.fn()} />
    );
    void missingOptions;

    const options: readonly ChartGroupByOption<DeliveryGroupBy>[] = [
      { value: "workspace", label: "Workspace" },
      { value: "milestone", label: "Milestone" },
      { value: "assignee", label: "Team member" },
    ];

    const onChange = vi.fn();
    render(
      <GroupBySelector<DeliveryGroupBy>
        value="workspace"
        onChange={onChange}
        options={options}
        label="Split by"
      />,
    );

    const select = screen.getByRole("combobox", { name: "Split by" });
    expect(
      within(select)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Workspace", "Milestone", "Team member"]);

    fireEvent.change(select, { target: { value: "milestone" } });
    expect(onChange).toHaveBeenCalledWith("milestone");
  });

  it("leaves the dimension alone when the choice is not one it offers", () => {
    const onChange = vi.fn();
    render(
      <GroupBySelector
        value="assignee"
        onChange={onChange}
        options={[{ value: "assignee", label: "Team member" }]}
      />,
    );

    // A value the control does not offer cannot name a dimension.
    fireEvent.change(selector(), { target: { value: "" } });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("takes the id the caller gives it", () => {
    render(
      <GroupBySelector
        value="assignee"
        onChange={vi.fn()}
        id="delivery-group-by"
      />,
    );

    expect(selector()).toHaveAttribute("id", "delivery-group-by");
  });

  it("greys itself out when it is disabled", () => {
    render(<GroupBySelector value="assignee" onChange={vi.fn()} disabled />);

    expect(selector()).toBeDisabled();
  });
});
