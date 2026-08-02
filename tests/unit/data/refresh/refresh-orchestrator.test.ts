/**
 * `src/data/refresh/refresh-orchestrator` unit tests.
 *
 * The orchestrator is the US2 single entry point that drives a
 * refresh from the user's click to a persisted cache update. The
 * tests pin:
 *
 * - Success path: projects + tasks are fetched, normalised, staged,
 *   and committed in one Dexie transaction. The RefreshSession
 *   transitions to `succeeded` with a non-null `finishedAt`. The
 *   `itemsRetrieved` count reflects the projects + tasks fetched.
 *
 * - Pagination: the orchestrator drives the multi-page walk via
 *   `next_page.offset` until the field is null; a multi-page
 *   project fetch produces the union of every page's rows.
 *
 * - FR-014 inheritance integration: a subtask whose `wire.projects[]`
 *   is empty inherits its parent's projectGids when both are
 *   staged in the same refresh.
 *
 * - PriorityField derivation (FR-081 / FR-082): the cache row's
 *   `status` and `expectedOptionIds` reflect the observed option
 *   union across the project's tasks.
 *
 * - Dependency edges: per-edge cache rows with `dependsOnTaskAccessible`
 *   resolved against the in-scope task set.
 *
 * - Failure modes: every `AsanaClientResult` failure variant maps to
 *   the correct `RefreshOutcome` reason AND the correct persisted
 *   `RefreshSession.status` per the failure-mode table in the
 *   orchestrator's docstring. The live cache stays untouched on
 *   every failure (FR-022 atomic refresh integrity).
 *
 * - Cancellation: an aborted AbortSignal between pagination pages
 *   discards the staging buffer and transitions the session to
 *   `cancelled`. The cache is untouched.
 *
 * - Commit failure: a thrown Dexie error inside the commit
 *   transaction surfaces as a `partial_failure` outcome with
 *   reason `network_error`; the session is transitioned to
 *   `partial_failure` and the cache stays untouched.
 *
 * Determinism
 * -----------
 * The tests use a fake `AsanaClientSurface` that returns scripted
 * data inline, the real `RefreshStagingRepository` singleton
 * (against the live Dexie store backed by `fake-indexeddb`), and
 * a controllable sessionId generator. The sessionId is captured
 * from the outcome (every `RefreshOutcome` variant carries it) so
 * a follow-up `db.refreshSessions.get(sessionId)` lookup never
 * re-invokes the generator and ends up looking up a different row.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { z } from "zod";

import { refreshStagingRepository } from "../../../../src/data/db/repositories/refresh-staging.repository";
import { db, type RefreshSession } from "../../../../src/data/db/schema";
import {
  createRefreshOrchestrator,
  type AsanaClientSurface,
  type RefreshOrchestrator,
  type RefreshOrchestratorDeps,
} from "../../../../src/data/refresh/refresh-orchestrator";
import type {
  asanaProjectListResponseSchema,
  asanaTaskListResponseSchema,
} from "../../../../src/data/asana/schemas";
import type { AsanaClientResult } from "../../../../src/data/asana/types";

type WireProject = z.infer<
  typeof asanaProjectListResponseSchema
>["data"][number];
type WireTask = z.infer<typeof asanaTaskListResponseSchema>["data"][number];

/* -------------------------------------------------------------------------- */
/* Test fixtures                                                              */
/* -------------------------------------------------------------------------- */

const WORKSPACE_GID = "ws-1";
const TOKEN = "test-token";

function makeWireProject(
  overrides: Partial<WireProject> = {},
): WireProject {
  return {
    gid: "project-1",
    name: "Project 1",
    resource_type: "project",
    archived: false,
    ...overrides,
  };
}

function makeWireTask(
  overrides: Partial<WireTask> = {},
): WireTask {
  return {
    gid: "task-1",
    name: "Task 1",
    resource_type: "task",
    resource_subtype: "default_task",
    created_at: "2026-07-01T09:00:00.000Z",
    modified_at: "2026-07-15T09:00:00.000Z",
    ...overrides,
  };
}

function okProjects(rows: WireProject[]): AsanaClientResult<z.infer<
  typeof asanaProjectListResponseSchema
>> {
  return { outcome: "ok", data: { data: rows, next_page: null } };
}

function pageProjects(
  rows: WireProject[],
  nextOffset: string,
): AsanaClientResult<z.infer<typeof asanaProjectListResponseSchema>> {
  return {
    outcome: "ok",
    data: {
      data: rows,
      next_page: { offset: nextOffset, path: "/projects" },
    },
  };
}

function okTasks(rows: WireTask[]): AsanaClientResult<z.infer<
  typeof asanaTaskListResponseSchema
>> {
  return { outcome: "ok", data: { data: rows, next_page: null } };
}

/* -------------------------------------------------------------------------- */
/* Fake client                                                                */
/* -------------------------------------------------------------------------- */

interface FakeClientHandlers {
  readonly projects: (
    args: { offset?: string; workspaceGid: string },
  ) => AsanaClientResult<z.infer<typeof asanaProjectListResponseSchema>>;
  readonly tasks: (
    args: { offset?: string; projectGid: string },
  ) => AsanaClientResult<z.infer<typeof asanaTaskListResponseSchema>>;
}

function makeFakeClient(handlers: FakeClientHandlers): AsanaClientSurface {
  return {
    fetchProjectsPage: (_token, workspaceGid, options) =>
      Promise.resolve(
        handlers.projects({
          offset: options?.offset,
          workspaceGid,
        }),
      ),
    fetchTasksPage: (_token, projectGid, options) =>
      Promise.resolve(
        handlers.tasks({ offset: options?.offset, projectGid }),
      ),
  };
}

/* -------------------------------------------------------------------------- */
/* Orchestrator factory helper                                                */
/* -------------------------------------------------------------------------- */

interface OrchestratorHandles {
  readonly orchestrator: RefreshOrchestrator;
  readonly sessionIds: readonly string[];
}

function makeOrchestrator(
  client: AsanaClientSurface,
  options: Partial<
    Pick<RefreshOrchestratorDeps, "now" | "makeSessionId">
  > = {},
): OrchestratorHandles {
  const sessionIds: string[] = [];
  let sessionCounter = 0;
  const makeSessionId =
    options.makeSessionId ??
    (() => {
      sessionCounter += 1;
      const id = `session-test-${sessionCounter}`;
      sessionIds.push(id);
      return id;
    });
  // Always supply a sessionId generator we control — `now()` defaults
  // to the real clock so commit-time `finishedAt` is recent and the
  // assertion uses Date.parse tolerance rather than exact equality.
  const now =
    options.now ?? (() => new Date().toISOString());
  const orchestrator = createRefreshOrchestrator({
    asanaClient: client,
    staging: refreshStagingRepository,
    dbInstance: db,
    now,
    makeSessionId,
  });
  return { orchestrator, sessionIds };
}

async function clearAllStores(): Promise<void> {
  await db.workspaces.clear();
  await db.projects.clear();
  await db.portfolios.clear();
  await db.asanaTeams.clear();
  await db.teamMappingOverrides.clear();
  await db.personGroups.clear();
  await db.users.clear();
  await db.priorityFields.clear();
  await db.dependencies.clear();
  await db.sections.clear();
  await db.tasks.clear();
  await db.snapshots.clear();
  await db.refreshSessions.clear();
  await db.credentials.clear();
}

/**
 * Asserts that the supplied value is a parseable ISO instant within
 * `toleranceMs` of `Date.now()`. Used for RefreshSession.finishedAt
 * assertions where the staging repo's commit() path uses its own
 * `new Date().toISOString()` rather than the orchestrator's injected
 * `now()`.
 */
function expectRecentIso(value: string | null | undefined): void {
  expect(value).not.toBeNull();
  expect(typeof value).toBe("string");
  const parsed = Date.parse(value ?? "");
  expect(Number.isFinite(parsed)).toBe(true);
  expect(Math.abs(parsed - Date.now())).toBeLessThan(60_000);
}

/* -------------------------------------------------------------------------- */
/* Success path                                                               */
/* -------------------------------------------------------------------------- */

describe("createRefreshOrchestrator — success path", () => {
  beforeEach(async () => {
    await clearAllStores();
  });

  afterEach(async () => {
    await clearAllStores();
  });

  it("fetches projects + tasks, stages them, commits, and returns a success outcome", async () => {
    const client = makeFakeClient({
      projects: () =>
        okProjects([
          makeWireProject({
            gid: "p-1",
            name: "Project One",
            workspace: { gid: WORKSPACE_GID, name: "Workspace" },
          }),
        ]),
      tasks: () =>
        okTasks([
          makeWireTask({
            gid: "t-1",
            name: "Task One",
            projects: [{ gid: "p-1", name: "Project One" }],
          }),
          makeWireTask({
            gid: "t-2",
            name: "Task Two",
            projects: [{ gid: "p-1", name: "Project One" }],
            custom_fields: [
              {
                gid: "cf-1",
                name: "Priority",
                type: "enum",
                enum_value: { gid: "high" },
              },
            ],
          }),
        ]),
    });

    const { orchestrator, sessionIds } = makeOrchestrator(client);
    const outcome = await orchestrator.runRefresh({
      token: TOKEN,
      workspaceGid: WORKSPACE_GID,
      workspaceName: "Workspace",
    });

    expect(outcome.kind).toBe("success");
    if (outcome.kind !== "success") {
      return;
    }
    expect(outcome.itemsRetrieved).toBe(3); // 1 project + 2 tasks
    expect(outcome.sessionId).toBe(sessionIds[0]);
    expectRecentIso(outcome.completedAt);

    // Cache persistence — projects, tasks, priorityFields, asanaTeams all landed.
    const projects = await db.projects.toArray();
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({
      gid: "p-1",
      workspaceGid: WORKSPACE_GID,
      asanaTeamGid: null,
      archived: false,
    });

    const tasks = await db.tasks.toArray();
    expect(tasks).toHaveLength(2);
    expect(tasks.find((t) => t.gid === "t-2")?.priorityOptionId).toBe(
      "high",
    );

    const priorityFields = await db.priorityFields.toArray();
    expect(priorityFields).toHaveLength(1);
    expect(priorityFields[0]).toMatchObject({
      projectGid: "p-1",
      status: "malformed", // mixed: t-1 has no priority, t-2 has "high"
      expectedOptionIds: ["high"],
    });

    // No team ref on the project → no asanaTeams staged.
    expect(await db.asanaTeams.toArray()).toEqual([]);

    const session = await db.refreshSessions.get(outcome.sessionId);
    expect(session?.status).toBe("succeeded");
    expectRecentIso(session?.finishedAt);
  });

  it("drives the multi-page walk for projects (FR-021 pagination)", async () => {
    const callLog: Array<string | undefined> = [];
    const client = makeFakeClient({
      projects: ({ offset }) => {
        callLog.push(offset);
        if (offset === undefined) {
          return pageProjects(
            [makeWireProject({ gid: "p-1" })],
            "page-2-offset",
          );
        }
        if (offset === "page-2-offset") {
          return okProjects([makeWireProject({ gid: "p-2" })]);
        }
        throw new Error(`Unexpected offset ${offset}`);
      },
      tasks: () => okTasks([]),
    });

    const { orchestrator } = makeOrchestrator(client);
    const outcome = await orchestrator.runRefresh({
      token: TOKEN,
      workspaceGid: WORKSPACE_GID,
      workspaceName: "Workspace",
    });

    expect(outcome.kind).toBe("success");
    expect(callLog).toEqual([undefined, "page-2-offset"]);
    const projects = await db.projects.toArray();
    expect(projects.map((p) => p.gid).sort()).toEqual(["p-1", "p-2"]);
  });

  it("applies FR-014 subtask projectGids inheritance in the same refresh", async () => {
    const client = makeFakeClient({
      projects: () =>
        okProjects([
          makeWireProject({
            gid: "p-1",
            workspace: { gid: WORKSPACE_GID, name: "Workspace" },
          }),
        ]),
      tasks: () =>
        okTasks([
          makeWireTask({
            gid: "parent",
            name: "Parent task",
            projects: [{ gid: "p-1", name: "Project One" }],
          }),
          makeWireTask({
            gid: "subtask",
            name: "Subtask",
            parent: { gid: "parent", name: "Parent" },
            projects: [], // subtask with empty wire.projects inherits
          }),
        ]),
    });

    const { orchestrator } = makeOrchestrator(client);
    const outcome = await orchestrator.runRefresh({
      token: TOKEN,
      workspaceGid: WORKSPACE_GID,
      workspaceName: "Workspace",
    });

    expect(outcome.kind).toBe("success");
    const subtask = await db.tasks.get("subtask");
    expect(subtask?.projectGids).toEqual(["p-1"]);
    expect(subtask?.parentTaskGid).toBe("parent");
  });

  it("stages AsanaTeam cache rows when projects carry a team reference", async () => {
    const client = makeFakeClient({
      projects: () =>
        okProjects([
          makeWireProject({
            gid: "p-1",
            workspace: { gid: WORKSPACE_GID, name: "Workspace" },
            team: { gid: "team-1", name: "Engineering" },
          }),
          makeWireProject({
            gid: "p-2",
            workspace: { gid: WORKSPACE_GID, name: "Workspace" },
            team: { gid: "team-1", name: "Engineering" }, // duplicate
          }),
        ]),
      tasks: () => okTasks([]),
    });

    const { orchestrator } = makeOrchestrator(client);
    await orchestrator.runRefresh({
      token: TOKEN,
      workspaceGid: WORKSPACE_GID,
      workspaceName: "Workspace",
    });

    const teams = await db.asanaTeams.toArray();
    expect(teams).toHaveLength(1);
    expect(teams[0]).toMatchObject({ gid: "team-1", workspaceGid: WORKSPACE_GID });
  });

  it("stages Dependency cache rows with dependsOnTaskAccessible from the in-scope set", async () => {
    const client = makeFakeClient({
      projects: () =>
        okProjects([
          makeWireProject({
            gid: "p-1",
            workspace: { gid: WORKSPACE_GID, name: "Workspace" },
          }),
        ]),
      tasks: () =>
        okTasks([
          makeWireTask({
            gid: "t-1",
            name: "T1",
            projects: [{ gid: "p-1", name: "Project" }],
            dependencies: [{ gid: "t-2" }], // t-2 is in scope
          }),
          makeWireTask({
            gid: "t-2",
            name: "T2",
            projects: [{ gid: "p-1", name: "Project" }],
            dependencies: [{ gid: "missing" }], // not in scope
          }),
        ]),
    });

    const { orchestrator } = makeOrchestrator(client);
    await orchestrator.runRefresh({
      token: TOKEN,
      workspaceGid: WORKSPACE_GID,
      workspaceName: "Workspace",
    });

    const edges = await db.dependencies.toArray();
    expect(edges).toHaveLength(2);
    expect(edges.find((e) => e.dependsOnTaskGid === "t-2")).toMatchObject({
      dependsOnTaskAccessible: true,
    });
    expect(edges.find((e) => e.dependsOnTaskGid === "missing")).toMatchObject({
      dependsOnTaskAccessible: false,
    });
  });

  it("invokes the makeSessionId hook exactly once per refresh", async () => {
    let calls = 0;
    const client = makeFakeClient({
      projects: () => okProjects([]),
      tasks: () => okTasks([]),
    });
    const { orchestrator } = makeOrchestrator(client, {
      makeSessionId: () => {
        calls += 1;
        return `session-test-${calls}`;
      },
    });
    await orchestrator.runRefresh({
      token: TOKEN,
      workspaceGid: WORKSPACE_GID,
      workspaceName: "Workspace",
    });
    expect(calls).toBe(1);
  });

  it("transitions RefreshSession to succeeded with a recent finishedAt on commit", async () => {
    const client = makeFakeClient({
      projects: () =>
        okProjects([
          makeWireProject({
            gid: "p-1",
            workspace: { gid: WORKSPACE_GID, name: "Workspace" },
          }),
        ]),
      tasks: () => okTasks([]),
    });

    const { orchestrator } = makeOrchestrator(client);
    const outcome = await orchestrator.runRefresh({
      token: TOKEN,
      workspaceGid: WORKSPACE_GID,
      workspaceName: "Workspace",
    });
    expect(outcome.kind).toBe("success");
    if (outcome.kind !== "success") {
      return;
    }
    const session = await db.refreshSessions.get(outcome.sessionId);
    expect(session).toMatchObject<Partial<RefreshSession>>({
      id: outcome.sessionId,
      workspaceGid: WORKSPACE_GID,
      status: "succeeded",
      syncMode: "full",
    });
    expectRecentIso(session?.finishedAt);
  });
});

/* -------------------------------------------------------------------------- */
/* Failure modes                                                              */
/* -------------------------------------------------------------------------- */

describe("createRefreshOrchestrator — failure modes", () => {
  beforeEach(async () => {
    await clearAllStores();
  });

  afterEach(async () => {
    await clearAllStores();
  });

  function authFailure(): AsanaClientResult<unknown> {
    return { outcome: "auth_failure" };
  }
  function permissionFailure(): AsanaClientResult<unknown> {
    return { outcome: "permission_failure", resource: "/projects/p-1" };
  }
  function rateLimited(): AsanaClientResult<unknown> {
    return { outcome: "rate_limited", retryAfterMs: 60_000 };
  }
  function networkError(): AsanaClientResult<unknown> {
    return { outcome: "network_error", message: "fetch failed" };
  }
  function validationError(): AsanaClientResult<unknown> {
    return {
      outcome: "validation_error",
      issues: [
        {
          code: "invalid_type",
          expected: "string",
          path: ["gid"],
          message: "Expected string, received number",
          input: 42,
        },
      ],
    };
  }

  async function runWithFirstProjectsCall(
    first: AsanaClientResult<unknown>,
  ): Promise<{
    outcome: Awaited<ReturnType<RefreshOrchestrator["runRefresh"]>>;
    cacheBefore: { projects: unknown[]; tasks: unknown[] };
    session: RefreshSession | undefined;
  }> {
    // Cache a sentinel pre-refresh row that the orchestrator MUST NOT
    // touch (FR-022 — the previous good cache stays untouched on any
    // failure path).
    const sentinel = makeWireProject({ gid: "sentinel" });
    await db.projects.bulkPut([
      {
        gid: sentinel.gid,
        name: sentinel.name,
        workspaceGid: WORKSPACE_GID,
        asanaTeamGid: null,
        portfolioGids: [],
        archived: false,
      },
    ]);
    const cacheBefore = {
      projects: await db.projects.toArray(),
      tasks: await db.tasks.toArray(),
    };

    const client = makeFakeClient({
      projects: () =>
        first as ReturnType<FakeClientHandlers["projects"]>,
      tasks: () => okTasks([]),
    });
    const { orchestrator } = makeOrchestrator(client);
    const outcome = await orchestrator.runRefresh({
      token: TOKEN,
      workspaceGid: WORKSPACE_GID,
      workspaceName: "Workspace",
    });
    // Capture the session id from the outcome — every variant carries
    // it — so the follow-up lookup hits the same row the orchestrator
    // wrote.
    const sessionId =
      outcome.kind === "success" ? outcome.sessionId : outcome.sessionId;
    const session = await db.refreshSessions.get(sessionId);
    return { outcome, cacheBefore, session };
  }

  it("auth_failure on projects → partial_failure with reason auth_failure + session status auth_failure", async () => {
    const { outcome, cacheBefore, session } =
      await runWithFirstProjectsCall(authFailure());

    expect(outcome.kind).toBe("partial_failure");
    if (outcome.kind !== "partial_failure") {
      return;
    }
    expect(outcome.reason).toBe("auth_failure");
    expect(outcome.message).toMatch(/token was rejected/i);

    expect(session?.status).toBe("auth_failure");
    expect(session?.errorDetail).toMatch(/token was rejected/i);
    expectRecentIso(session?.finishedAt);

    // FR-022: cache untouched (sentinel row still present, no new rows).
    expect(await db.projects.toArray()).toEqual(cacheBefore.projects);
    expect(await db.tasks.toArray()).toEqual(cacheBefore.tasks);
  });

  it("permission_failure on tasks → partial_failure with reason permission_failure + session status permission_failure", async () => {
    const client = makeFakeClient({
      projects: () =>
        okProjects([
          makeWireProject({
            gid: "p-1",
            workspace: { gid: WORKSPACE_GID, name: "Workspace" },
          }),
        ]),
      tasks: () =>
        permissionFailure() as ReturnType<FakeClientHandlers["tasks"]>,
    });
    const { orchestrator } = makeOrchestrator(client);
    const outcome = await orchestrator.runRefresh({
      token: TOKEN,
      workspaceGid: WORKSPACE_GID,
      workspaceName: "Workspace",
    });

    expect(outcome.kind).toBe("partial_failure");
    if (outcome.kind !== "partial_failure") {
      return;
    }
    expect(outcome.reason).toBe("permission_failure");
    expect(outcome.message).toContain("/projects/p-1");

    const session = await db.refreshSessions.get(outcome.sessionId);
    expect(session?.status).toBe("permission_failure");

    // Projects were already staged but the buffer was discarded, so
    // the cache stays untouched.
    expect(await db.projects.toArray()).toEqual([]);
  });

  it("rate_limited → partial_failure with reason rate_limited + session status rate_limited", async () => {
    const { outcome, session } =
      await runWithFirstProjectsCall(rateLimited());

    expect(outcome.kind).toBe("partial_failure");
    if (outcome.kind !== "partial_failure") {
      return;
    }
    expect(outcome.reason).toBe("rate_limited");
    expect(outcome.message).toContain("60000ms");
    expect(session?.status).toBe("rate_limited");
  });

  it("network_error → partial_failure with reason network_error + session status partial_failure", async () => {
    const { outcome, session } =
      await runWithFirstProjectsCall(networkError());

    expect(outcome.kind).toBe("partial_failure");
    if (outcome.kind !== "partial_failure") {
      return;
    }
    expect(outcome.reason).toBe("network_error");
    expect(outcome.message).toContain("fetch failed");
    expect(session?.status).toBe("partial_failure");
  });

  it("validation_error → partial_failure with reason validation_error + session status partial_failure", async () => {
    const { outcome, session } =
      await runWithFirstProjectsCall(validationError());

    expect(outcome.kind).toBe("partial_failure");
    if (outcome.kind !== "partial_failure") {
      return;
    }
    expect(outcome.reason).toBe("validation_error");
    expect(outcome.message).toContain("gid");
    expect(session?.status).toBe("partial_failure");
    expect(session?.errorDetail).toContain("gid");
  });

  it("every failure path preserves the pre-refresh cache byte-identical (FR-022)", async () => {
    for (const failure of [
      authFailure(),
      permissionFailure(),
      rateLimited(),
      networkError(),
      validationError(),
    ]) {
      // Fresh database per failure iteration. The helper
      // (`runWithFirstProjectsCall`) seeds its own sentinel; we do
      // not pre-seed here so the sentinel's shape stays consistent
      // with the helper's. We then capture cacheBefore from the
      // helper's own returned value and compare the post-refresh
      // state to that.
      await clearAllStores();

      const { outcome, cacheBefore, session } =
        await runWithFirstProjectsCall(failure);

      expect(outcome.kind).toBe("partial_failure");
      expect(session?.status).not.toBe("running");
      expect(await db.projects.toArray()).toEqual(cacheBefore.projects);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Cancellation                                                               */
/* -------------------------------------------------------------------------- */

describe("createRefreshOrchestrator — cancellation", () => {
  beforeEach(async () => {
    await clearAllStores();
  });

  afterEach(async () => {
    await clearAllStores();
  });

  it("aborting the signal before the projects fetch transitions the session to cancelled and keeps the cache untouched", async () => {
    const controller = new AbortController();
    controller.abort();

    const client = makeFakeClient({
      projects: () => okProjects([]),
      tasks: () => okTasks([]),
    });
    const { orchestrator } = makeOrchestrator(client);

    const outcome = await orchestrator.runRefresh({
      token: TOKEN,
      workspaceGid: WORKSPACE_GID,
      workspaceName: "Workspace",
      signal: controller.signal,
    });

    expect(outcome.kind).toBe("cancelled");
    expect(await db.projects.toArray()).toEqual([]);
    if (outcome.kind !== "cancelled") {
      return;
    }
    const session = await db.refreshSessions.get(outcome.sessionId);
    expect(session?.status).toBe("cancelled");
    expect(session?.errorDetail).toMatch(/cancelled/i);
  });

  it("aborting the signal between pages transitions to cancelled", async () => {
    const controller = new AbortController();
    const client = makeFakeClient({
      projects: ({ offset }) => {
        if (offset === undefined) {
          // First page: abort before returning so the walk
          // observes the abort at the top of the loop.
          controller.abort();
          return pageProjects(
            [makeWireProject({ gid: "p-1" })],
            "page-2",
          );
        }
        return okProjects([]);
      },
      tasks: () => okTasks([]),
    });
    const { orchestrator } = makeOrchestrator(client);

    const outcome = await orchestrator.runRefresh({
      token: TOKEN,
      workspaceGid: WORKSPACE_GID,
      workspaceName: "Workspace",
      signal: controller.signal,
    });

    expect(outcome.kind).toBe("cancelled");
    // Cache stays untouched — the staging buffer was discarded.
    expect(await db.projects.toArray()).toEqual([]);
    if (outcome.kind !== "cancelled") {
      return;
    }
    const session = await db.refreshSessions.get(outcome.sessionId);
    expect(session?.status).toBe("cancelled");
  });
});

/* -------------------------------------------------------------------------- */
/* Commit failure                                                             */
/* -------------------------------------------------------------------------- */

describe("createRefreshOrchestrator — commit failure", () => {
  beforeEach(async () => {
    await clearAllStores();
  });

  afterEach(async () => {
    await clearAllStores();
  });

  it("a thrown commit transitions the session to partial_failure and leaves the cache untouched", async () => {
    const client = makeFakeClient({
      projects: () =>
        okProjects([
          makeWireProject({
            gid: "p-1",
            workspace: { gid: WORKSPACE_GID, name: "Workspace" },
          }),
        ]),
      tasks: () => okTasks([]),
    });
    const original = refreshStagingRepository.commit;
    refreshStagingRepository.commit = async () => {
      throw new Error("Simulated commit failure");
    };
    try {
      const { orchestrator } = makeOrchestrator(client);
      const outcome = await orchestrator.runRefresh({
        token: TOKEN,
        workspaceGid: WORKSPACE_GID,
        workspaceName: "Workspace",
      });
      expect(outcome.kind).toBe("partial_failure");
      if (outcome.kind !== "partial_failure") {
        return;
      }
      expect(outcome.reason).toBe("network_error");
      expect(outcome.message).toContain("Simulated commit failure");
      const session = await db.refreshSessions.get(outcome.sessionId);
      expect(session?.status).toBe("partial_failure");
      // Cache untouched.
      expect(await db.projects.toArray()).toEqual([]);
    } finally {
      refreshStagingRepository.commit = original;
    }
  });
});

/* -------------------------------------------------------------------------- */
/* RefreshSession lifecycle                                                   */
/* -------------------------------------------------------------------------- */

describe("createRefreshOrchestrator — RefreshSession lifecycle", () => {
  beforeEach(async () => {
    await clearAllStores();
  });

  afterEach(async () => {
    await clearAllStores();
  });

  it("seeds a running RefreshSession row BEFORE beginStaging (T047 contract)", async () => {
    const observed: { sessionIdAtSeed: string | null } = {
      sessionIdAtSeed: null,
    };

    const originalBegin = refreshStagingRepository.beginStaging;
    refreshStagingRepository.beginStaging = async (sessionId) => {
      const row = await db.refreshSessions.get(sessionId);
      observed.sessionIdAtSeed = row?.id ?? null;
      return originalBegin.call(refreshStagingRepository, sessionId);
    };

    const client = makeFakeClient({
      projects: () =>
        okProjects([
          makeWireProject({
            gid: "p-1",
            workspace: { gid: WORKSPACE_GID, name: "Workspace" },
          }),
        ]),
      tasks: () => okTasks([]),
    });
    const { orchestrator } = makeOrchestrator(client);
    const outcome = await orchestrator.runRefresh({
      token: TOKEN,
      workspaceGid: WORKSPACE_GID,
      workspaceName: "Workspace",
    });
    expect(outcome.kind).toBe("success");
    expect(observed.sessionIdAtSeed).not.toBeNull();
    expect(observed.sessionIdAtSeed).toMatch(/^session-test-/);
    refreshStagingRepository.beginStaging = originalBegin;
  });
});
