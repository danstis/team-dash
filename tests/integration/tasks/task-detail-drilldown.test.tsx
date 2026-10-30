/**
 * BSOD-316 (T067) — the task-detail drill-down.
 *
 * Spec / contract references
 * --------------------------
 * - FR-037 (spec.md): "When a user drills from an aggregate figure into
 *   task detail, the system MUST show all of that task's project
 *   memberships." A task can sit in several projects at once, and the
 *   drill-down is exactly where the user checks WHY a task counted —
 *   so a single membership is never enough.
 * - FR-053 (spec.md): the task detail reached via drill-down MUST show
 *   sufficient source fields (project memberships, dates, assignee,
 *   priority, completion state, estimate/actual, dependencies) for the
 *   user to verify why the task was included in, or excluded from, the
 *   metric they drilled from.
 * - FR-054 (spec.md): each task detail MUST provide a link to the
 *   corresponding task in Asana that does not expose the personal
 *   access token.
 * - FR-009 / FR-010 (spec.md): the token is used for read-only API
 *   access only, and every outbound request that opens a task in Asana
 *   MUST be constructed without embedding the token in the URL or the
 *   request.
 * - Constitution Principle IV (Local-First Privacy): the token never
 *   appears in a URL, a log, or a rendered surface.
 *
 * What this test pins
 * -------------------
 *
 * 1. The drawer shows EVERY project membership of the task — not the
 *    first one, not a filtered subset (FR-037).
 *
 * 2. The drawer lists the task's dependencies, by name when the caller
 *    knows them and by their raw id when it does not (FR-053). The
 *    unknown dependency is shown honestly rather than dropped.
 *
 * 3. The drawer shows the source fields the user needs to verify the
 *    task: assignee, priority, dates, completion state, estimate and
 *    actual time (FR-053).
 *
 * 4. The "Open in Asana" link points at the task in Asana, and carries
 *    NO token — not in the href, not in any attribute of the rendered
 *    surface, and not in any outbound request (FR-010, FR-054,
 *    Principle IV).
 *
 * The token precondition
 * ----------------------
 * The token assertions are only meaningful when a token really is live
 * in the app while the drawer renders, so this file seeds a session
 * token through the same public surface the token-entry form uses
 * (`CredentialsProvider.setSessionToken`) and renders the drawer inside
 * that provider. The drawer never asks the provider for anything — the
 * point of the assertions is that it does not NEED to.
 *
 * Test-first discipline
 * ----------------------
 * Per Constitution Principle III this file lands with the failing test
 * first: the Red phase fails with "Cannot find module
 * '../../../src/features/tasks/TaskDetailDrawer'", and the same file
 * goes green once `TaskDetailDrawer` implements the surface below —
 * with no test-side change.
 *
 * Boundary
 * --------
 * `tests/integration/**` runs against jsdom per `tests/setup.ts`. No
 * browser, no live Asana workspace, no real personal access token
 * (Principle III, NFR-005). The fixtures below are synthetic.
 */
import { type ReactElement, useEffect, useState } from "react";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CredentialsProvider,
  useCredentials,
} from "../../../src/app/credentials-context";
import { db, type Task } from "../../../src/data/db/schema";
import { TaskDetailDrawer } from "../../../src/features/tasks/TaskDetailDrawer";

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A plaintext token value engineered so its middle substring is unique
 * enough to never collide with anything else in the rendered markup.
 * The same shape is used by the credential-boundary suite
 * (`tests/integration/credentials/token-masking.test.tsx`).
 */
const PLAINTEXT_TOKEN = "team-dash-T067-do-not-render-7z9k";

/** The masked identifier the token-entry surface feeds to the provider. */
const MASKED_IDENTIFIER = "…7z9k";

/**
 * The unique middle of the plaintext token. Asserted on separately so a
 * regression that splits the token across a URL (e.g. a query string
 * assembled from two fragments) still fails.
 */
const PLAINTEXT_MARKER_MIDDLE = "team-dash-T067-do-not-render";

/** The people the drawer may name. */
const USERS = [
  { gid: "user-alice", name: "Alice Nkemelu" },
  { gid: "user-bo", name: "Bo Chen" },
] as const;

/**
 * The projects the drawer may name. The task under test belongs to
 * three of them, so a drawer that showed only the first membership
 * would still look plausible.
 */
const PROJECTS = [
  { gid: "project-apollo", name: "Apollo" },
  { gid: "project-borealis", name: "Borealis" },
  { gid: "project-cirrus", name: "Cirrus" },
] as const;

/** The human names of the priority options, keyed by their option id. */
const PRIORITY_LABELS = {
  "priority-high": "High",
  "priority-low": "Low",
} as const;

/**
 * Builds a cached task row. Every field of the cache record is
 * supplied, so the fixture is a real `Task` and not a look-alike.
 */
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

/**
 * The task under test: three project memberships (FR-037), two
 * dependencies (FR-053), and an estimate/actual pair the user can
 * check the metric against.
 */
const TASK = makeTask({
  projectGids: ["project-apollo", "project-borealis", "project-cirrus"],
  dependsOnTaskGids: ["task-2", "task-3"],
});

/**
 * The dependency the caller knows by name. `task-3` is deliberately
 * NOT in the caller's task set: the drawer must still show it, by its
 * raw id, rather than dropping a dependency it cannot name.
 */
const KNOWN_DEPENDENCY = makeTask({
  gid: "task-2",
  name: "Archive the old campaign",
  projectGids: ["project-borealis"],
});

/** The task set the caller hands to the drawer. */
const KNOWN_TASKS: readonly Task[] = [TASK, KNOWN_DEPENDENCY];

/* -------------------------------------------------------------------------- */
/* Harness                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Module-scoped holder for the live credentials context value, so the
 * test body can seed the token the way the token-entry surface does.
 */
let capturedCredentials: ReturnType<typeof useCredentials> | null = null;

/** Captures the credentials context value; renders nothing. */
function CredentialsControl(): null {
  capturedCredentials = useCredentials();
  return null;
}

/**
 * The drawer, mounted once the app holds a live session token.
 *
 * The drawer is a pure presentation surface: it takes the task and the
 * name lookups and renders them. It is mounted here INSIDE the
 * credentials provider so the token really is live while it renders —
 * a drawer that reached for the token would find one, and the
 * assertions below would catch it.
 */
function DrawerHarness(): ReactElement {
  const credentials = useCredentials();
  const [tokenIsLive, setTokenIsLive] = useState(false);

  useEffect(() => {
    if (credentials.state === "ready") {
      setTokenIsLive(true);
    }
  }, [credentials.state]);

  return (
    <>
      <CredentialsControl />
      {tokenIsLive ? (
        <TaskDetailDrawer
          task={TASK}
          users={USERS}
          projects={PROJECTS}
          tasks={KNOWN_TASKS}
          priorityLabels={PRIORITY_LABELS}
          timezone="utc"
        />
      ) : null}
    </>
  );
}

/**
 * Renders the drawer behind a live session token and waits for it to
 * appear.
 */
async function renderDrawerWithLiveToken(): Promise<void> {
  render(
    <CredentialsProvider>
      <DrawerHarness />
    </CredentialsProvider>,
  );

  await waitFor(() => {
    expect(capturedCredentials?.state).toBe("first_run");
  });

  const credentials = capturedCredentials;
  if (credentials === null) {
    throw new Error("The credentials context was never captured");
  }

  const { act } = await import("react");
  await act(async () => {
    await credentials.setSessionToken(PLAINTEXT_TOKEN, MASKED_IDENTIFIER);
  });

  await waitFor(() => {
    expect(screen.getByTestId("task-detail-drawer")).toBeInTheDocument();
  });
}

/* -------------------------------------------------------------------------- */
/* The drill-down                                                             */
/* -------------------------------------------------------------------------- */

describe("BSOD-316 (T067) — the task-detail drill-down", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    // The provider reads IndexedDB on mount; a leftover record from
    // another suite would pin the wrong credential state.
    await db.credentials.clear();
    capturedCredentials = null;
    // Every outbound request the surface makes would land here. The
    // drawer must make none: an "Open in Asana" link is a link, not a
    // fetch.
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(async () => {
    cleanup();
    fetchSpy.mockRestore();
    capturedCredentials = null;
    await db.credentials.clear();
  });

  it("shows every project membership of the task", async () => {
    await renderDrawerWithLiveToken();

    const memberships = within(
      screen.getByTestId("task-detail-projects"),
    ).getAllByTestId("task-detail-project");

    // FR-037 — all three memberships, not the first one.
    expect(memberships).toHaveLength(3);
    expect(memberships.map((item) => item.textContent)).toEqual([
      "Apollo",
      "Borealis",
      "Cirrus",
    ]);
    expect(
      memberships.map((item) => item.getAttribute("data-project-gid")),
    ).toEqual(["project-apollo", "project-borealis", "project-cirrus"]);
  });

  it("lists the task's dependencies, naming the ones it knows", async () => {
    await renderDrawerWithLiveToken();

    const dependencies = within(
      screen.getByTestId("task-detail-dependencies"),
    ).getAllByTestId("task-detail-dependency");

    // FR-053 — every dependency is listed.
    expect(dependencies).toHaveLength(2);
    expect(dependencies[0]).toHaveTextContent("Archive the old campaign");
    expect(dependencies[0]).toHaveAttribute("data-dependency-gid", "task-2");
    // A dependency the caller cannot name is shown by its raw id, not
    // dropped: a missing dependency would read as "no dependencies".
    expect(dependencies[1]).toHaveTextContent("task-3");
    expect(dependencies[1]).toHaveAttribute("data-dependency-gid", "task-3");
  });

  it("shows the source fields the user verifies the task against", async () => {
    await renderDrawerWithLiveToken();

    expect(screen.getByTestId("task-detail-name")).toHaveTextContent(
      "Publish the migration checklist",
    );
    expect(screen.getByTestId("task-detail-assignee")).toHaveTextContent(
      "Alice Nkemelu",
    );
    expect(screen.getByTestId("task-detail-priority")).toHaveTextContent(
      "High",
    );
    expect(screen.getByTestId("task-detail-created")).toHaveTextContent(
      "2 Mar 2026",
    );
    expect(screen.getByTestId("task-detail-due")).toHaveTextContent(
      "10 Mar 2026",
    );
    expect(screen.getByTestId("task-detail-completed")).toHaveTextContent(
      /not completed/i,
    );
    expect(screen.getByTestId("task-detail-status")).toHaveTextContent(
      "Incomplete",
    );
    expect(screen.getByTestId("task-detail-estimate")).toHaveTextContent(
      "30 min",
    );
    expect(screen.getByTestId("task-detail-actual")).toHaveTextContent(
      "25 min",
    );
  });

  it("links to the task in Asana without carrying the token", async () => {
    await renderDrawerWithLiveToken();

    const link = screen.getByTestId("task-detail-asana-link");
    const href = link.getAttribute("href") ?? "";

    // FR-054 — the link points at the task in Asana.
    expect(href).toContain("https://app.asana.com/");
    expect(href).toContain(TASK.gid);
    // FR-010 / Principle IV — no token in the URL, in any attribute, or
    // anywhere in the rendered surface.
    expect(href).not.toContain(PLAINTEXT_TOKEN);
    expect(href).not.toContain(PLAINTEXT_MARKER_MIDDLE);
    expect(document.body.innerHTML).not.toContain(PLAINTEXT_TOKEN);
    expect(document.body.innerHTML).not.toContain(PLAINTEXT_MARKER_MIDDLE);
    // The link opens in a new tab without handing the opener over.
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noreferrer");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("makes no outbound request of its own", async () => {
    await renderDrawerWithLiveToken();

    // The drawer reads what it is handed; it never calls out. A request
    // here would be a request the token could ride on (FR-009/FR-010).
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
