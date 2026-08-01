/**
 * T047 — `RefreshStagingRepository` contract tests (Red phase).
 *
 * Pins the `RefreshStagingRepository` interface from
 * `specs/001-asana-team-dashboard/contracts/storage-repository.md` against
 * the live Dexie schema in `src/data/db/schema.ts` and the `getInScopeTasks`
 * predicate delivered by T055 (BSOD-308). The contract test is the gate
 * that catches a future contributor who accidentally:
 *
 *   - leaks a partially-staged row into `getInScopeTasks()` before
 *     `commit()` is called (the staging area must be hidden from the
 *     in-scope query while the refresh is in flight — FR-022 / FR-068);
 *   - splits the commit across multiple Dexie transactions (US2's atomicity
 *     guarantee rests on a single-transaction flush);
 *   - or applies a non-byte-identical state after `discard()` (a cleanup
 *     path that best-effort-cleaned-up would still leave the cache
 *     observable as different from pre-staging).
 *
 * Constitution Principle III says these tests are the test-first gate that
 * gets written before the implementation lands. The Red phase assertion
 * chain (each test fails for the intended reason before the implementation
 * is checked in) is exercised manually by the agent: the file is created
 * with no matching implementation, the suite is run, and the suite fails
 * with `Cannot find module` / `describe is not a function`-style errors.
 *
 * Test scope (per the T047 task row and the contract):
 *
 * - `discard()` is byte-identical to the pre-staging state. The test
 *   snapshots `getInScopeTasks()` BEFORE the staging session, stages
 *   upserts that would change the cache if applied, discards, and asserts
 *   the post-discard `getInScopeTasks()` is structurally identical — both
 *   "during staging" and "after discard" — to the pre-staging snapshot.
 *
 * - `commit()` is atomic. The test stages a multi-batch write, spies on
 *   the Dexie table to inject a mid-batch throw, and asserts:
 *     (a) `commit()` rejects with the injected error;
 *     (b) the cache stores are unchanged — no partial application
 *         survives the rollback (Dexie's native transaction atomicity
 *         is the enforcement mechanism).
 *
 * Why `tests/contract/` (not `tests/unit/`)
 * -----------------------------------------
 * The repository is the boundary the refresh orchestrator (T051) crosses
 * during every refresh. The contract tests live next to the
 * `CacheRepository` and `CredentialRepository` contract tests so a single
 * CI command (`npm run test:contract`) validates the whole storage layer.
 *
 * Determinism
 * -----------
 * The tests use deterministic fixtures (fixed `gid`s, fixed ISO timestamps,
 * a single seeded `RefreshSession` row) and never reach a live Asana
 * workspace. The Dexie store is reset between tests through before/afterEach
 * clearing — closing the database would fire `DatabaseClosedError` on any
 * pending promise from a previous test's refresh orchestrator mount, which
 * would surface as an unhandled rejection.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cacheRepository } from "../../src/data/db/repositories/cache.repository";
import { db } from "../../src/data/db/schema";
import type { Project, RefreshSession, Task } from "../../src/data/db/schema";

const WORKSPACE_GID = "ws-1";
const SESSION_ID = "session-1";

function makeProject(
  overrides: Partial<Project> & Pick<Project, "gid">,
): Project {
  return {
    name: "Project",
    workspaceGid: WORKSPACE_GID,
    asanaTeamGid: "team-1",
    portfolioGids: [],
    archived: false,
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> & Pick<Task, "gid">): Task {
  return {
    name: "Task",
    assigneeGid: null,
    projectGids: ["proj-active"],
    parentTaskGid: null,
    resourceSubtype: "default_task",
    createdAt: "2026-07-01T09:00:00.000Z",
    modifiedAt: "2026-07-15T09:00:00.000Z",
    completedAt: null,
    dueAt: null,
    priorityOptionId: null,
    estimatedMinutes: null,
    actualMinutes: null,
    dependsOnTaskGids: [],
    lastSeenInScopeAt: "2026-07-31T00:00:00.000Z",
    outOfScopeReason: null,
    ...overrides,
  };
}

function makeRefreshSession(
  overrides: Partial<RefreshSession> & Pick<RefreshSession, "id">,
): RefreshSession {
  return {
    workspaceGid: WORKSPACE_GID,
    startedAt: "2026-07-31T00:00:00.000Z",
    finishedAt: null,
    status: "running",
    itemsRetrieved: 0,
    errorDetail: null,
    syncMode: "full",
    ...overrides,
  };
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
 * Seed the canonical pre-staging state used by both contract tests.
 * Two active projects in the workspace, four in-scope tasks spanning
 * every task shape the reportable predicate cares about (standard,
 * subtask, multi-project, completed). The pre-staging snapshot of
 * `getInScopeTasks()` is the "byte-identical" reference both tests
 * compare against.
 */
async function seedPreStagingState(): Promise<void> {
  await cacheRepository.upsertProjects([
    makeProject({ gid: "proj-active" }),
    makeProject({ gid: "proj-active-2" }),
    makeProject({ gid: "proj-archived", archived: true }),
  ]);
  await cacheRepository.upsertTasks([
    makeTask({ gid: "task-active", projectGids: ["proj-active"] }),
    makeTask({
      gid: "task-subtask",
      projectGids: ["proj-active"],
      parentTaskGid: "task-active",
    }),
    makeTask({
      gid: "task-multi-project",
      projectGids: ["proj-active", "proj-active-2"],
    }),
    makeTask({
      gid: "task-completed",
      projectGids: ["proj-active"],
      completedAt: "2026-07-20T09:00:00.000Z",
    }),
    makeTask({
      gid: "task-archived-project",
      projectGids: ["proj-archived"],
    }),
  ]);
  await db.refreshSessions.put(makeRefreshSession({ id: SESSION_ID }));
}

describe("T047 RefreshStagingRepository (contracts/storage-repository.md)", () => {
  beforeEach(async () => {
    await clearAllStores();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await clearAllStores();
  });

  it("exposes a RefreshStagingRepository with beginStaging / stageUpsert / commit / discard", async () => {
    // The contract surface is the four named functions. A future
    // contributor who collapses the API to a single `upsert` method
    // (or who drops `discard()`) fails this test before the contract
    // loss can reach the refresh orchestrator.
    const importModule =
      await import("../../src/data/db/repositories/refresh-staging.repository");
    const repository = importModule.refreshStagingRepository;
    expect(typeof repository.beginStaging).toBe("function");
    expect(typeof repository.stageUpsert).toBe("function");
    expect(typeof repository.commit).toBe("function");
    expect(typeof repository.discard).toBe("function");
  });

  describe("discard() leaves getInScopeTasks() byte-identical to pre-staging", () => {
    it("does not surface staged upserts to getInScopeTasks() and does not mutate the cache after discard", async () => {
      await seedPreStagingState();

      const before = await cacheRepository.getInScopeTasks(WORKSPACE_GID);

      const importModule =
        await import("../../src/data/db/repositories/refresh-staging.repository");
      const { refreshStagingRepository } = importModule;

      await refreshStagingRepository.beginStaging(SESSION_ID);

      // Stage upserts that would change the cache if applied: a brand
      // new project, a brand new task, and a re-archive of an existing
      // active project. A staging buffer that prematurely flushes to
      // the live stores would show the new task in getInScopeTasks()
      // and would drop the previously-active project from the in-scope
      // set. The byte-identical assertion catches both regressions.
      await refreshStagingRepository.stageUpsert("projects", [
        makeProject({ gid: "proj-new-active", name: "New active project" }),
        makeProject({
          gid: "proj-active",
          name: "Project re-archived",
          archived: true,
        }),
      ]);
      await refreshStagingRepository.stageUpsert("tasks", [
        makeTask({
          gid: "task-new-staged",
          projectGids: ["proj-new-active"],
        }),
        makeTask({
          gid: "task-active",
          name: "Task renamed",
          projectGids: ["proj-archived"],
        }),
      ]);

      // Mid-staging: the cache must already be byte-identical to the
      // pre-staging snapshot. A staging buffer that flushes optimistically
      // (or one that does not separate staging from the live stores) fails
      // this assertion.
      const duringStaging =
        await cacheRepository.getInScopeTasks(WORKSPACE_GID);
      expect(duringStaging).toEqual(before);

      await refreshStagingRepository.discard(SESSION_ID);

      const after = await cacheRepository.getInScopeTasks(WORKSPACE_GID);
      expect(after).toEqual(before);
      expect(after).toEqual(duringStaging);

      // The previously-good cache rows are still in their original
      // shape — the staging rename and re-archive never reached the
      // live stores.
      const persistedTask = await db.tasks.get("task-active");
      expect(persistedTask?.name).toBe("Task");
      expect(persistedTask?.projectGids).toEqual(["proj-active"]);

      const persistedProject = await db.projects.get("proj-active");
      expect(persistedProject?.archived).toBe(false);
      expect(persistedProject?.name).toBe("Project");

      // The staged-only rows are not visible in the cache.
      await expect(db.tasks.get("task-new-staged")).resolves.toBeUndefined();
      await expect(db.projects.get("proj-new-active")).resolves.toBeUndefined();
    });

    it("a second discard on the same session is a no-op (idempotent)", async () => {
      await seedPreStagingState();

      const before = await cacheRepository.getInScopeTasks(WORKSPACE_GID);

      const importModule =
        await import("../../src/data/db/repositories/refresh-staging.repository");
      const { refreshStagingRepository } = importModule;

      await refreshStagingRepository.beginStaging(SESSION_ID);
      await refreshStagingRepository.stageUpsert("tasks", [
        makeTask({ gid: "task-staged", projectGids: ["proj-active"] }),
      ]);

      await refreshStagingRepository.discard(SESSION_ID);
      await expect(
        refreshStagingRepository.discard(SESSION_ID),
      ).resolves.toBeUndefined();

      const after = await cacheRepository.getInScopeTasks(WORKSPACE_GID);
      expect(after).toEqual(before);
      await expect(db.tasks.get("task-staged")).resolves.toBeUndefined();
    });
  });

  describe("commit() atomicity (FR-022 / FR-068 / Dexie transaction enforcement)", () => {
    it("opens a single Dexie transaction covering every cache store it touches", async () => {
      await seedPreStagingState();

      const importModule =
        await import("../../src/data/db/repositories/refresh-staging.repository");
      const { refreshStagingRepository } = importModule;

      await refreshStagingRepository.beginStaging(SESSION_ID);
      await refreshStagingRepository.stageUpsert("tasks", [
        makeTask({ gid: "task-commit-1", projectGids: ["proj-active"] }),
      ]);
      await refreshStagingRepository.stageUpsert("projects", [
        makeProject({ gid: "proj-active-3", name: "Third active project" }),
      ]);

      const transactionSpy = vi.spyOn(db, "transaction");

      await refreshStagingRepository.commit(SESSION_ID);

      // Exactly one Dexie transaction across the call. A two-stage
      // "flush tasks then projects" implementation would fail this
      // assertion.
      const commitTransactions = transactionSpy.mock.calls.filter((call) => {
        const mode = call[0];
        const tables = call[1] as unknown;
        return (
          mode === "rw" &&
          Array.isArray(tables) &&
          (tables as readonly unknown[]).includes("tasks")
        );
      });
      expect(commitTransactions).toHaveLength(1);

      // The transaction's store list covers every cache store that
      // participated in the staging buffer. A future contributor who
      // forgets to add a new store to the commit's transaction scope
      // fails this assertion before the partial-apply bug ships.
      const call = commitTransactions[0];
      const tables = call?.[1] as unknown as string[];
      expect(Array.from(tables).sort()).toEqual(
        ["projects", "refreshSessions", "tasks"].sort(),
      );

      // The single transaction transitions the seeded session to
      // succeeded and stamps a finishedAt.
      const session = await db.refreshSessions.get(SESSION_ID);
      expect(session?.status).toBe("succeeded");
      expect(session?.finishedAt).not.toBeNull();
    });

    it("never partially applies when a mid-batch throw escapes (Dexie atomicity)", async () => {
      // FR-022 / FR-068 — the headline contract. The cache stores must
      // be unchanged after a mid-commit throw; Dexie's native
      // transaction atomicity is the enforcement mechanism. The test
      // intercepts the first `bulkPut` inside the commit transaction
      // to throw so neither the staged rows nor the RefreshSession
      // transition survives the rollback.
      await seedPreStagingState();

      const before = await cacheRepository.getInScopeTasks(WORKSPACE_GID);

      const importModule =
        await import("../../src/data/db/repositories/refresh-staging.repository");
      const { refreshStagingRepository } = importModule;

      await refreshStagingRepository.beginStaging(SESSION_ID);
      await refreshStagingRepository.stageUpsert("tasks", [
        makeTask({ gid: "task-commit-a", projectGids: ["proj-active"] }),
        makeTask({ gid: "task-commit-b", projectGids: ["proj-active"] }),
        makeTask({ gid: "task-commit-c", projectGids: ["proj-active"] }),
      ]);
      await refreshStagingRepository.stageUpsert("projects", [
        makeProject({ gid: "proj-active-3", name: "Third active project" }),
      ]);

      vi.spyOn(db.tasks, "bulkPut").mockImplementation(() => {
        throw new Error("Simulated mid-batch Dexie write failure");
      });

      await expect(refreshStagingRepository.commit(SESSION_ID)).rejects.toThrow(
        "Simulated mid-batch Dexie write failure",
      );

      // The cache stores are byte-identical to the pre-staging state —
      // no partial application of the staged batch survives the
      // rollback. A future contributor who splits the commit across
      // multiple Dexie transactions (or who flushes the staging buffer
      // eagerly during stageUpsert) leaks the first batch and fails
      // this assertion.
      const after = await cacheRepository.getInScopeTasks(WORKSPACE_GID);
      expect(after).toEqual(before);

      // None of the staged rows landed in the tasks or projects tables.
      await expect(db.tasks.get("task-commit-a")).resolves.toBeUndefined();
      await expect(db.tasks.get("task-commit-b")).resolves.toBeUndefined();
      await expect(db.tasks.get("task-commit-c")).resolves.toBeUndefined();
      await expect(db.projects.get("proj-active-3")).resolves.toBeUndefined();

      // The RefreshSession status is unchanged — the failed commit
      // does not transition the session to succeeded.
      const session = await db.refreshSessions.get(SESSION_ID);
      expect(session?.status).toBe("running");
      expect(session?.finishedAt).toBeNull();
    });

    it("applies every staged row and transitions the session to succeeded on a clean commit", async () => {
      await seedPreStagingState();

      const importModule =
        await import("../../src/data/db/repositories/refresh-staging.repository");
      const { refreshStagingRepository } = importModule;

      await refreshStagingRepository.beginStaging(SESSION_ID);
      await refreshStagingRepository.stageUpsert("tasks", [
        makeTask({ gid: "task-commit-1", projectGids: ["proj-active"] }),
        makeTask({ gid: "task-commit-2", projectGids: ["proj-active-2"] }),
      ]);
      await refreshStagingRepository.stageUpsert("projects", [
        makeProject({ gid: "proj-active-3", name: "Third active project" }),
      ]);

      await refreshStagingRepository.commit(SESSION_ID);

      // The staged rows are now visible in the live stores.
      await expect(db.tasks.get("task-commit-1")).resolves.toMatchObject({
        name: "Task",
        projectGids: ["proj-active"],
      });
      await expect(db.tasks.get("task-commit-2")).resolves.toMatchObject({
        projectGids: ["proj-active-2"],
      });
      await expect(db.projects.get("proj-active-3")).resolves.toMatchObject({
        name: "Third active project",
        archived: false,
      });

      // The pre-existing rows are intact (a non-key-preserving bulkPut
      // would have wiped them).
      await expect(db.tasks.get("task-active")).resolves.toBeDefined();
      await expect(db.projects.get("proj-active")).resolves.toBeDefined();

      // The session is transitioned to succeeded with a finishedAt.
      const session = await db.refreshSessions.get(SESSION_ID);
      expect(session?.status).toBe("succeeded");
      expect(session?.finishedAt).not.toBeNull();
    });

    it("leaves the RefreshSession status unchanged after discard", async () => {
      await seedPreStagingState();

      const importModule =
        await import("../../src/data/db/repositories/refresh-staging.repository");
      const { refreshStagingRepository } = importModule;

      await refreshStagingRepository.beginStaging(SESSION_ID);
      await refreshStagingRepository.stageUpsert("tasks", [
        makeTask({ gid: "task-discard-1", projectGids: ["proj-active"] }),
      ]);

      await refreshStagingRepository.discard(SESSION_ID);

      // discard() MUST NOT advance the session state machine; the
      // running session remains running and the orchestrator (T051)
      // is the only caller that may transition it to a terminal
      // status.
      const session = await db.refreshSessions.get(SESSION_ID);
      expect(session?.status).toBe("running");
      expect(session?.finishedAt).toBeNull();
    });
  });
});
