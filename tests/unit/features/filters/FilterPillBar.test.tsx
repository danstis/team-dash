import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";

import type { FilterCriteria, ISODate } from "../../../../src/domain/types";
import { FilterPillBar } from "../../../../src/features/filters/FilterPillBar";

const NOW = new Date("2026-03-15T00:00:00.000Z");
const USERS = [
  { gid: "u1", name: "Ana" },
  { gid: "u2", name: "Ben" },
  { gid: "u3", name: "Cleo" },
];
const PROJECTS = [{ gid: "p1", name: "Apollo" }];

const INITIAL: FilterCriteria = {
  dateRange: {
    start: "2026-02-13" as ISODate,
    end: "2026-03-15" as ISODate,
    preset: "last_30_days",
  },
};

let latest: FilterCriteria = INITIAL;

function Harness(): ReactElement {
  const [criteria, setCriteria] = useState<FilterCriteria>(INITIAL);
  latest = criteria;
  return (
    <FilterPillBar
      criteria={criteria}
      onChange={(next) => {
        latest = next;
        setCriteria(next);
      }}
      users={USERS}
      projects={PROJECTS}
      now={NOW}
      timezone="utc"
    />
  );
}

function openMenu(): HTMLElement {
  fireEvent.click(screen.getByRole("button", { name: /Add filter/ }));
  return screen.getByRole("menu");
}

describe("FilterPillBar", () => {
  afterEach(() => {
    cleanup();
    latest = INITIAL;
  });

  it("starts with the date range pill, which can be edited but not removed", () => {
    render(<Harness />);
    expect(
      screen.getByRole("button", { name: /Date range: Last 30 days/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Remove Date range filter" }),
    ).not.toBeInTheDocument();
  });

  it("lists only the filters not yet in use in the add menu", () => {
    render(<Harness />);
    let menu = openMenu();
    expect(
      within(menu).queryByRole("menuitem", { name: "Date range" }),
    ).not.toBeInTheDocument();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Completion" }));
    fireEvent.click(screen.getByLabelText("Incomplete"));

    menu = openMenu();
    expect(
      within(menu).queryByRole("menuitem", { name: "Completion" }),
    ).not.toBeInTheDocument();
    expect(
      within(menu).getByRole("menuitem", { name: "Person" }),
    ).toBeInTheDocument();
  });

  it("adds a multi-value filter as one pill and edits it in place", () => {
    render(<Harness />);
    fireEvent.click(
      within(openMenu()).getByRole("menuitem", { name: "Person" }),
    );
    fireEvent.click(screen.getByLabelText("Ana"));
    fireEvent.click(screen.getByLabelText("Ben"));
    fireEvent.click(screen.getByLabelText("Cleo"));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(latest.assigneeGids).toEqual(["u1", "u2", "u3"]);
    expect(
      screen.getByRole("button", { name: /Person: Ana, Ben \+1/ }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Person:/ }));
    fireEvent.click(screen.getByLabelText("Cleo"));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(latest.assigneeGids).toEqual(["u1", "u2"]);
  });

  it("removes a pill with its X and clears the rest with Clear filters", () => {
    render(<Harness />);
    fireEvent.click(
      within(openMenu()).getByRole("menuitem", { name: "Overdue" }),
    );
    fireEvent.click(screen.getByLabelText("Overdue"));
    expect(latest.overdueState).toBe("overdue");

    fireEvent.click(
      screen.getByRole("button", { name: "Remove Overdue filter" }),
    );
    expect(latest.overdueState).toBeNull();

    fireEvent.click(
      within(openMenu()).getByRole("menuitem", { name: "Project" }),
    );
    fireEvent.click(screen.getByLabelText("Apollo"));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(latest.projectGids).toBeUndefined();
    expect(latest.dateRange?.preset).toBe("last_30_days");
  });

  it("Escape closes an editor without committing the draft", () => {
    render(<Harness />);
    fireEvent.click(
      within(openMenu()).getByRole("menuitem", { name: "Person" }),
    );
    fireEvent.click(screen.getByLabelText("Ana"));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(latest.assigneeGids).toBeUndefined();
    expect(
      screen.queryByRole("button", { name: /Person:/ }),
    ).not.toBeInTheDocument();
  });

  it("changing the date range preset updates the window", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /Date range:/ }));
    fireEvent.click(screen.getByLabelText("This month"));
    expect(latest.dateRange?.preset).toBe("this_month");
    expect(
      screen.getByRole("button", { name: /Date range: This month/ }),
    ).toBeInTheDocument();
  });
});
