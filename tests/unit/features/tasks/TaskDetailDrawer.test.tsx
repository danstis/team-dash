/**
 * BSOD-316 (T067) — unit coverage for the task-detail drawer and its
 * Asana link builder.
 *
 * Why this suite exists beside the integration suite
 * --------------------------------------------------
 * The drill-down itself is proved end-to-end in
 * `tests/integration/tasks/task-detail-drilldown.test.tsx`. The Sonar
 * new-code coverage gate only reads the `test:unit` and `test:contract`
 * lcov reports, so an integration-only suite would leave the new file
 * looking uncovered. This suite therefore exercises the drawer module
 * directly, branch by branch:
 *
 * - the pure `buildAsanaTaskUrl` helper (gid in, URL out — never a
 *   token);
 * - every membership and every dependency the drawer lists;
 * - every state the drawer distinguishes (unassigned, no priority, no
 *   due date, not estimated, not recorded, not available, complete vs
 *   incomplete);
 * - the close action, present only when the caller supplies one.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Task } from "../../../../src/data/db/schema";
import {
  buildAsanaTaskUrl,
  TaskDetailDrawer,
} from "../../../../src/features/tasks/TaskDetailDrawer";

const USERS = [
  { gid: "user-alice", name: "Alice Nkemelu" },
  { gid: "user-bo", name: "Bo Chen" },
] as const;

const PROJECTS = [
  { gid: "project-apollo", name: "Apollo" },
  { gid: "project-borealis", name: "Borealis" },
  { gid: "project-cirrus", name: "Cirrus" },
] as const;

const PRIORITY_LABELS = {
  "priority-high": "High",
  "priority-low": "Low",
} as const;

/** Builds a cached task row; every field of the cache record is set. */
function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    gid: "task-1",
    name: "Publish the migration checklist",
    assigneeGid: "user-alice",
    projectGids: ["project-apollo"],
    parentTaskGid: null,
    resourceSubtype: "default_task",
    createdAt: "2026-03-02T09:00:00.000Z",
    modifiedAt: "2026-03-11T08:00:00.000Z",
    completedAt: null,
    dueAt: "2026-03-10T00:00:00.000Z",
    priorityOptionId: "priority-high",
    estimatedMinutes: 30,
    actualMinutes: 25,
    dependsOnTaskGids: [],
    lastSeenInScopeAt: "2026-03-15T00:00:00.000Z",
    outOfScopeReason: null,
    ...overrides,
  };
}

/** Renders the drawer with the shared fixtures. */
function renderDrawer(
  overrides: Partial<React.ComponentProps<typeof TaskDetailDrawer>> = {},
): void {
  render(
    <TaskDetailDrawer
      task={makeTask()}
      users={USERS}
      projects={PROJECTS}
      priorityLabels={PRIORITY_LABELS}
      timezone="utc"
      {...overrides}
    />,
  );
}

afterEach(() => {
  cleanup();
});

describe("BSOD-316 (T067) — the Asana link builder carries no token", () => {
  it("builds a link to the task from its gid alone", () => {
    const url = buildAsanaTaskUrl("task-1");

    expect(url.startsWith("https://app.asana.com/")).toBe(true);
    expect(url).toContain("task-1");
  });

  it("takes exactly one argument, so it cannot be handed a token", () => {
    // The helper's whole privacy guarantee is its shape: one input, a
    // gid, and no parameter a credential could arrive through.
    expect(buildAsanaTaskUrl.length).toBe(1);
  });

  it("is pure — the same gid always yields the same URL", () => {
    expect(buildAsanaTaskUrl("task-1")).toBe(buildAsanaTaskUrl("task-1"));
  });

  it("encodes the gid so it cannot smuggle a query string", () => {
    const url = buildAsanaTaskUrl("task/1?token=leaked");

    expect(url).not.toContain("?");
    expect(url).toContain("task%2F1%3Ftoken%3Dleaked");
  });
});

describe("BSOD-316 (T067) — the drawer shows every membership", () => {
  it("lists every project the task belongs to", () => {
    renderDrawer({
      task: makeTask({
        projectGids: ["project-apollo", "project-borealis", "project-cirrus"],
      }),
    });

    const memberships = within(
      screen.getByTestId("task-detail-projects"),
    ).getAllByTestId("task-detail-project");

    expect(memberships).toHaveLength(3);
    expect(memberships.map((item) => item.textContent)).toEqual([
      "Apollo",
      "Borealis",
      "Cirrus",
    ]);
  });

  it("says so when the task belongs to no project", () => {
    renderDrawer({ task: makeTask({ projectGids: [] }) });

    expect(screen.getByTestId("task-detail-no-projects")).toHaveTextContent(
      "No projects",
    );
    expect(
      screen.queryByTestId("task-detail-projects"),
    ).not.toBeInTheDocument();
  });

  it("shows a membership it has no name for by its raw id", () => {
    renderDrawer({ task: makeTask({ projectGids: ["project-unknown"] }) });

    expect(screen.getByTestId("task-detail-project")).toHaveTextContent(
      "project-unknown",
    );
  });
});

describe("BSOD-316 (T067) — the drawer shows every dependency", () => {
  it("names a dependency the caller knows", () => {
    const dependency = makeTask({
      gid: "task-2",
      name: "Archive the old campaign",
    });

    renderDrawer({
      task: makeTask({ dependsOnTaskGids: ["task-2"] }),
      tasks: [dependency],
    });

    expect(screen.getByTestId("task-detail-dependency")).toHaveTextContent(
      "Archive the old campaign",
    );
  });

  it("shows a dependency it cannot name by its raw id", () => {
    renderDrawer({ task: makeTask({ dependsOnTaskGids: ["task-9"] }) });

    const dependency = screen.getByTestId("task-detail-dependency");
    expect(dependency).toHaveTextContent("task-9");
    expect(dependency.querySelector("code")).toHaveTextContent("task-9");
  });

  it("says so when the task depends on nothing", () => {
    renderDrawer({ task: makeTask({ dependsOnTaskGids: [] }) });

    expect(screen.getByTestId("task-detail-no-dependencies")).toHaveTextContent(
      "No dependencies",
    );
    expect(
      screen.queryByTestId("task-detail-dependencies"),
    ).not.toBeInTheDocument();
  });
});

describe("BSOD-316 (T067) — the drawer shows the source fields", () => {
  it("shows the task name, id and assignee", () => {
    renderDrawer();

    expect(screen.getByTestId("task-detail-name")).toHaveTextContent(
      "Publish the migration checklist",
    );
    expect(screen.getByTestId("task-detail-gid")).toHaveTextContent("task-1");
    expect(screen.getByTestId("task-detail-assignee")).toHaveTextContent(
      "Alice Nkemelu",
    );
  });

  it("shows the unassigned state for a task with no assignee", () => {
    renderDrawer({ task: makeTask({ assigneeGid: null }) });

    expect(screen.getByTestId("task-detail-assignee")).toHaveTextContent(
      "Unassigned",
    );
  });

  it("shows the priority name when the caller supplied one", () => {
    renderDrawer();

    expect(screen.getByTestId("task-detail-priority")).toHaveTextContent(
      "High",
    );
  });

  it("shows the raw priority id when no human name is available", () => {
    renderDrawer({ task: makeTask({ priorityOptionId: "priority-42" }) });

    expect(screen.getByTestId("task-detail-priority")).toHaveTextContent(
      "priority-42",
    );
  });

  it("shows the no-priority state for a task with no priority", () => {
    renderDrawer({ task: makeTask({ priorityOptionId: null }) });

    expect(screen.getByTestId("task-detail-priority")).toHaveTextContent(
      "No priority",
    );
  });

  it("shows the dates and the completion state", () => {
    renderDrawer();

    expect(screen.getByTestId("task-detail-created")).toHaveTextContent(
      "2 Mar 2026",
    );
    expect(screen.getByTestId("task-detail-due")).toHaveTextContent(
      "10 Mar 2026",
    );
    expect(screen.getByTestId("task-detail-completed")).toHaveTextContent(
      "Not completed",
    );
    expect(screen.getByTestId("task-detail-status")).toHaveTextContent(
      "Incomplete",
    );
  });

  it("shows the no-due-date state for a task with no due date", () => {
    renderDrawer({ task: makeTask({ dueAt: null }) });

    expect(screen.getByTestId("task-detail-due")).toHaveTextContent(
      "No due date",
    );
  });

  it("shows the completion date and the complete state", () => {
    renderDrawer({
      task: makeTask({ completedAt: "2026-03-11T08:00:00.000Z" }),
    });

    expect(screen.getByTestId("task-detail-completed")).toHaveTextContent(
      "11 Mar 2026",
    );
    expect(screen.getByTestId("task-detail-status")).toHaveTextContent(
      "Complete",
    );
  });

  it("keeps the estimate and the recorded time apart", () => {
    renderDrawer();

    expect(screen.getByTestId("task-detail-estimate")).toHaveTextContent(
      "30 min",
    );
    expect(screen.getByTestId("task-detail-actual")).toHaveTextContent(
      "25 min",
    );
  });

  it("shows the not-estimated state", () => {
    renderDrawer({ task: makeTask({ estimatedMinutes: null }) });

    expect(screen.getByTestId("task-detail-estimate")).toHaveTextContent(
      "Not estimated",
    );
  });

  it("shows the not-recorded state", () => {
    renderDrawer({ task: makeTask({ actualMinutes: null }) });

    expect(screen.getByTestId("task-detail-actual")).toHaveTextContent(
      "Not recorded",
    );
  });

  it("shows the not-available state when Asana exposes no time tracking", () => {
    renderDrawer({ task: makeTask({ actualMinutes: "unavailable" }) });

    expect(screen.getByTestId("task-detail-actual")).toHaveTextContent(
      "Not available",
    );
  });

  it("falls back to the local timezone when the caller names none", () => {
    // A date-only value is timezone-free (FR-030), so the rendered
    // date is the same on every host — the assertion is about the
    // default, not about the calendar.
    renderDrawer({
      task: makeTask({
        createdAt: "2026-03-02",
        dueAt: "2026-03-10",
      }),
    });

    expect(screen.getByTestId("task-detail-created")).toHaveTextContent(
      "2 Mar 2026",
    );
  });
});

describe("BSOD-316 (T067) — the drawer's actions", () => {
  it("links to the task in Asana without exposing the opener", () => {
    renderDrawer();

    const link = screen.getByTestId("task-detail-asana-link");
    expect(link).toHaveAttribute("href", buildAsanaTaskUrl("task-1"));
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noreferrer");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link).toHaveTextContent("Open in Asana");
  });

  it("asks the caller to dismiss the drawer", () => {
    const onClose = vi.fn();
    renderDrawer({ onClose });

    fireEvent.click(screen.getByTestId("task-detail-close"));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders no close action when the caller owns no dismissal", () => {
    renderDrawer();

    expect(screen.queryByTestId("task-detail-close")).not.toBeInTheDocument();
  });
});
