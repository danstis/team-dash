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
 * - The compound-key stores (`dependencies`, `snapshots`) dedupe
 *   successive `stageUpsert` calls on the same logical key. The
 *   pre-fix implementation keyed the in-memory `Map` by the raw
 *   `[taskGid, dependsOnTaskGid]` / `[workspaceGid, localCalendarDate]`
 *   array literal, which `Map` references by identity; the fix
 *   stringifies the compound key so the buffer's "upsert-keyed"
 *   invariant holds for every store.
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
import type {
  AsanaTeam,
  Dependency,
  Portfolio,
  PriorityField,
  Project,
  RefreshSession,
  Section,
  Snapshot,
  Task,
  User,
  Workspace,
} from "../../src/data/db/schema";

const WORKSPACE_GID = "ws-1";
const SESSION_ID = "session-1";

function makeWorkspace(
  overrides: Partial<Workspace> & Pick<Workspace, "gid">,
): Workspace {
  return {
    name: "Workspace",
    selectedAt: "2026-07-31T00:00:00.000Z",
    ...overrides,
  };
}

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

function makePortfolio(
  overrides: Partial<Portfolio> & Pick<Portfolio, "gid">,
): Portfolio {
  return {
    name: "Portfolio",
    workspaceGid: WORKSPACE_GID,
    projectGids: ["proj-active"],
    ...overrides,
  };
}

function makeAsanaTeam(
  overrides: Partial<AsanaTeam> & Pick<AsanaTeam, "gid">,
): AsanaTeam {
  return {
    name: "Team",
    workspaceGid: WORKSPACE_GID,
    ...overrides,
  };
}

function makeUser(overrides: Partial<User> & Pick<User, "gid">): User {
  return {
    name: "User",
    email: "user@example.com",
    workspaceGid: WORKSPACE_GID,
    ...overrides,
  };
}

function makePriorityField(
  overrides: Partial<PriorityField> & Pick<PriorityField, "projectGid">,
): PriorityField {
  return {
    expectedOptionIds: ["p1"],
    status: "ok",
    ...overrides,
  };
}

function makeDependency(
  overrides: Partial<Dependency> &
    Pick<Dependency, "taskGid" | "dependsOnTaskGid">,
): Dependency {
  return {
    dependsOnTaskAccessible: true,
    ...overrides,
  };
}

function makeSection(
  overrides: Partial<Section> & Pick<Section, "gid">,
): Section {
  return {
    name: "Section",
    projectGid: "proj-active",
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

function makeSnapshot(
  overrides: Partial<Snapshot> &
    Pick<Snapshot, "workspaceGid" | "localCalendarDate">,
): Snapshot {
  return {
    incompleteCount: 0,
    incompleteEstimatedMinutes: 0,
    unestimatedIncompleteCount: 0,
    computedFromRefreshId: SESSION_ID,
    computedAt: "2026-07-31T00:00:00.000Z",
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

  describe("beginStaging / stageUpsert shape invariants", () => {
    it("an empty rows array is a no-op (no buffer entry, no error)", async () => {
      const importModule =
        await import("../../src/data/db/repositories/refresh-staging.repository");
      const { refreshStagingRepository } = importModule;

      await refreshStagingRepository.beginStaging(SESSION_ID);
      await expect(
        refreshStagingRepository.stageUpsert("tasks", []),
      ).resolves.toBeUndefined();

      // A clean commit should still succeed against the seeded-only
      // session (no staged rows); the session transitions to succeeded
      // and the cache is byte-identical to the pre-staging state.
      await db.refreshSessions.put(makeRefreshSession({ id: SESSION_ID }));
      await refreshStagingRepository.commit(SESSION_ID);

      const session = await db.refreshSessions.get(SESSION_ID);
      expect(session?.status).toBe("succeeded");
    });

    it("stageUpsert without a prior beginStaging throws a descriptive error", async () => {
      const importModule =
        await import("../../src/data/db/repositories/refresh-staging.repository");
      const { refreshStagingRepository } = importModule;

      await expect(
        refreshStagingRepository.stageUpsert("tasks", [
          makeTask({ gid: "task-staged" }),
        ]),
      ).rejects.toThrow(/without a prior beginStaging/);
    });

    it("a second beginStaging re-initialises the buffer (the prior batch is discarded)", async () => {
      await db.refreshSessions.put(makeRefreshSession({ id: SESSION_ID }));
      await db.refreshSessions.put(makeRefreshSession({ id: "session-2" }));

      const importModule =
        await import("../../src/data/db/repositories/refresh-staging.repository");
      const { refreshStagingRepository } = importModule;

      await refreshStagingRepository.beginStaging(SESSION_ID);
      await refreshStagingRepository.stageUpsert("tasks", [
        makeTask({ gid: "task-first-batch" }),
      ]);

      // A different sessionId restarts the staging buffer; the first
      // batch's rows do not survive into the second batch's commit.
      await refreshStagingRepository.beginStaging("session-2");
      await refreshStagingRepository.stageUpsert("tasks", [
        makeTask({ gid: "task-second-batch" }),
      ]);

      await refreshStagingRepository.commit("session-2");

      await expect(db.tasks.get("task-first-batch")).resolves.toBeUndefined();
      await expect(db.tasks.get("task-second-batch")).resolves.toBeDefined();
    });
  });

  describe("compound-key stores (dependencies, snapshots) dedupe across stageUpsert calls", () => {
    it("two stageUpsert calls for the same logical dependency land as one buffer entry", async () => {
      // The pre-fix bug: `primaryKeyOf` returned a freshly allocated
      // `[taskGid, dependsOnTaskGid]` array literal, which `Map` keys
      // by reference. Two `stageUpsert` calls for the same logical
      // dependency therefore produced two buffer entries instead of
      // upserting the first one. The fix stringifies the compound key
      // so dedup works; this test pins the fix.
      await db.refreshSessions.put(makeRefreshSession({ id: SESSION_ID }));

      const importModule =
        await import("../../src/data/db/repositories/refresh-staging.repository");
      const { refreshStagingRepository } = importModule;

      await refreshStagingRepository.beginStaging(SESSION_ID);
      await refreshStagingRepository.stageUpsert("dependencies", [
        makeDependency({
          taskGid: "task-1",
          dependsOnTaskGid: "task-2",
          dependsOnTaskAccessible: true,
        }),
      ]);
      await refreshStagingRepository.stageUpsert("dependencies", [
        makeDependency({
          taskGid: "task-1",
          dependsOnTaskGid: "task-2",
          dependsOnTaskAccessible: false,
        }),
      ]);

      await refreshStagingRepository.commit(SESSION_ID);

      // The second upsert overwrote the first; the persisted row is
      // the latest. A non-deduping buffer would either throw a
      // Dexie primary-key collision on `bulkPut` or persist two
      // rows with the same compound key.
      const dependencies = await db.dependencies
        .where("[taskGid+dependsOnTaskGid]")
        .equals(["task-1", "task-2"])
        .toArray();
      expect(dependencies).toHaveLength(1);
      expect(dependencies[0]).toMatchObject({
        taskGid: "task-1",
        dependsOnTaskGid: "task-2",
        dependsOnTaskAccessible: false,
      });
    });

    it("two stageUpsert calls for the same logical snapshot land as one buffer entry", async () => {
      // Same fix verification for the second compound-key store.
      await db.refreshSessions.put(makeRefreshSession({ id: SESSION_ID }));

      const importModule =
        await import("../../src/data/db/repositories/refresh-staging.repository");
      const { refreshStagingRepository } = importModule;

      await refreshStagingRepository.beginStaging(SESSION_ID);
      await refreshStagingRepository.stageUpsert("snapshots", [
        makeSnapshot({
          workspaceGid: WORKSPACE_GID,
          localCalendarDate: "2026-07-31",
          incompleteCount: 1,
        }),
      ]);
      await refreshStagingRepository.stageUpsert("snapshots", [
        makeSnapshot({
          workspaceGid: WORKSPACE_GID,
          localCalendarDate: "2026-07-31",
          incompleteCount: 99,
        }),
      ]);

      await refreshStagingRepository.commit(SESSION_ID);

      const snapshots = await db.snapshots
        .where("[workspaceGid+localCalendarDate]")
        .equals([WORKSPACE_GID, "2026-07-31"])
        .toArray();
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0]?.incompleteCount).toBe(99);
    });

    it("distinct compound keys both land in the persisted cache", async () => {
      await db.refreshSessions.put(makeRefreshSession({ id: SESSION_ID }));

      const importModule =
        await import("../../src/data/db/repositories/refresh-staging.repository");
      const { refreshStagingRepository } = importModule;

      await refreshStagingRepository.beginStaging(SESSION_ID);
      await refreshStagingRepository.stageUpsert("dependencies", [
        makeDependency({ taskGid: "task-1", dependsOnTaskGid: "task-2" }),
        makeDependency({ taskGid: "task-1", dependsOnTaskGid: "task-3" }),
      ]);
      await refreshStagingRepository.stageUpsert("snapshots", [
        makeSnapshot({
          workspaceGid: WORKSPACE_GID,
          localCalendarDate: "2026-07-30",
        }),
        makeSnapshot({
          workspaceGid: WORKSPACE_GID,
          localCalendarDate: "2026-07-31",
        }),
      ]);

      await refreshStagingRepository.commit(SESSION_ID);

      const dependencies = await db.dependencies.toArray();
      expect(dependencies).toHaveLength(2);

      const snapshots = await db.snapshots.toArray();
      expect(snapshots).toHaveLength(2);
    });

    it("dependency staging preserves two opaque gid pairs that collide under delimiter concatenation", async () => {
      await db.refreshSessions.put(makeRefreshSession({ id: SESSION_ID }));

      const importModule =
        await import("../../src/data/db/repositories/refresh-staging.repository");
      const { refreshStagingRepository } = importModule;

      await refreshStagingRepository.beginStaging(SESSION_ID);
      await refreshStagingRepository.stageUpsert("dependencies", [
        makeDependency({
          taskGid: ' task\0dep "alpha" ',
          dependsOnTaskGid: "x\\beta",
        }),
        makeDependency({
          taskGid: " task ",
          dependsOnTaskGid: 'dep\0x\\beta "alpha" ',
        }),
      ]);

      await refreshStagingRepository.commit(SESSION_ID);

      const dependencies = await db.dependencies
        .orderBy("[taskGid+dependsOnTaskGid]")
        .toArray();
      expect(dependencies).toHaveLength(2);
      expect(dependencies).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            taskGid: " task ",
            dependsOnTaskGid: 'dep\0x\\beta "alpha" ',
          }),
          expect.objectContaining({
            taskGid: ' task\0dep "alpha" ',
            dependsOnTaskGid: "x\\beta",
          }),
        ]),
      );
    });

    it("snapshot staging preserves two opaque key pairs that collide under delimiter concatenation", async () => {
      await db.refreshSessions.put(makeRefreshSession({ id: SESSION_ID }));

      const importModule =
        await import("../../src/data/db/repositories/refresh-staging.repository");
      const { refreshStagingRepository } = importModule;

      await refreshStagingRepository.beginStaging(SESSION_ID);
      await refreshStagingRepository.stageUpsert("snapshots", [
        makeSnapshot({
          workspaceGid: ' workspace\0東京 "north" ',
          localCalendarDate: "x\\2026-08-01",
          incompleteCount: 7,
        }),
        makeSnapshot({
          workspaceGid: " workspace ",
          localCalendarDate: '東京\0x\\2026-08-01 "north" ',
          incompleteCount: 11,
        }),
      ]);

      await refreshStagingRepository.commit(SESSION_ID);

      const snapshots = await db.snapshots
        .orderBy("[workspaceGid+localCalendarDate]")
        .toArray();
      expect(snapshots).toHaveLength(2);
      expect(snapshots).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            workspaceGid: " workspace ",
            localCalendarDate: '東京\0x\\2026-08-01 "north" ',
            incompleteCount: 11,
          }),
          expect.objectContaining({
            workspaceGid: ' workspace\0東京 "north" ',
            localCalendarDate: "x\\2026-08-01",
            incompleteCount: 7,
          }),
        ]),
      );
    });
  });

  describe("commit() commits every staged cache store in the single transaction", () => {
    it("flushes every cache-store type (workspaces, projects, portfolios, asanaTeams, users, priorityFields, sections, dependencies, snapshots) through the same transaction", async () => {
      await db.refreshSessions.put(makeRefreshSession({ id: SESSION_ID }));

      const importModule =
        await import("../../src/data/db/repositories/refresh-staging.repository");
      const { refreshStagingRepository } = importModule;

      await refreshStagingRepository.beginStaging(SESSION_ID);
      await refreshStagingRepository.stageUpsert("workspaces", [
        makeWorkspace({ gid: WORKSPACE_GID, name: "Workspace" }),
      ]);
      await refreshStagingRepository.stageUpsert("projects", [
        makeProject({ gid: "proj-active", name: "Active project" }),
      ]);
      await refreshStagingRepository.stageUpsert("portfolios", [
        makePortfolio({ gid: "port-1" }),
      ]);
      await refreshStagingRepository.stageUpsert("asanaTeams", [
        makeAsanaTeam({ gid: "team-1" }),
      ]);
      await refreshStagingRepository.stageUpsert("users", [
        makeUser({ gid: "user-1" }),
      ]);
      await refreshStagingRepository.stageUpsert("priorityFields", [
        makePriorityField({ projectGid: "proj-active" }),
      ]);
      await refreshStagingRepository.stageUpsert("sections", [
        makeSection({ gid: "section-1" }),
      ]);
      await refreshStagingRepository.stageUpsert("dependencies", [
        makeDependency({ taskGid: "task-1", dependsOnTaskGid: "task-2" }),
      ]);
      await refreshStagingRepository.stageUpsert("snapshots", [
        makeSnapshot({
          workspaceGid: WORKSPACE_GID,
          localCalendarDate: "2026-07-31",
        }),
      ]);

      await refreshStagingRepository.commit(SESSION_ID);

      await expect(db.workspaces.get(WORKSPACE_GID)).resolves.toBeDefined();
      await expect(db.projects.get("proj-active")).resolves.toBeDefined();
      await expect(db.portfolios.get("port-1")).resolves.toBeDefined();
      await expect(db.asanaTeams.get("team-1")).resolves.toBeDefined();
      await expect(db.users.get("user-1")).resolves.toBeDefined();
      await expect(db.priorityFields.get("proj-active")).resolves.toBeDefined();
      await expect(db.sections.get("section-1")).resolves.toBeDefined();
      await expect(
        db.dependencies.get(["task-1", "task-2"]),
      ).resolves.toBeDefined();
      await expect(
        db.snapshots.get([WORKSPACE_GID, "2026-07-31"]),
      ).resolves.toBeDefined();

      const session = await db.refreshSessions.get(SESSION_ID);
      expect(session?.status).toBe("succeeded");
    });

    it("rejects commit when the sessionId does not match the active staging session", async () => {
      await db.refreshSessions.put(makeRefreshSession({ id: SESSION_ID }));

      const importModule =
        await import("../../src/data/db/repositories/refresh-staging.repository");
      const { refreshStagingRepository } = importModule;

      await refreshStagingRepository.beginStaging(SESSION_ID);
      await refreshStagingRepository.stageUpsert("tasks", [
        makeTask({ gid: "task-1" }),
      ]);

      await expect(
        refreshStagingRepository.commit("wrong-session"),
      ).rejects.toThrow(/active staging session/);

      // The cache is still untouched by the rejected commit.
      await expect(db.tasks.get("task-1")).resolves.toBeUndefined();
    });

    it("rejects commit when the seeded RefreshSession row is missing", async () => {
      // The orchestrator owns session seeding; this is the catch when
      // a future contributor forgets to seed the session before the
      // staging buffer opens.
      const importModule =
        await import("../../src/data/db/repositories/refresh-staging.repository");
      const { refreshStagingRepository } = importModule;

      await refreshStagingRepository.beginStaging(SESSION_ID);
      await refreshStagingRepository.stageUpsert("tasks", [
        makeTask({ gid: "task-1" }),
      ]);

      await expect(refreshStagingRepository.commit(SESSION_ID)).rejects.toThrow(
        /was not seeded/,
      );
    });

    it("rejects discard when the sessionId does not match the active staging session", async () => {
      const importModule =
        await import("../../src/data/db/repositories/refresh-staging.repository");
      const { refreshStagingRepository } = importModule;

      await refreshStagingRepository.beginStaging(SESSION_ID);
      await refreshStagingRepository.stageUpsert("tasks", [
        makeTask({ gid: "task-1" }),
      ]);

      await expect(
        refreshStagingRepository.discard("wrong-session"),
      ).rejects.toThrow(/active staging session/);
    });

    it("preserves the existing session's workspaceGid, startedAt, and itemsRetrieved on commit", async () => {
      // The session transition MUST preserve every other field on the
      // existing seeded row, not replace the entire row. A future
      // contributor who {@link db.refreshSessions.put} a brand-new
      // row (instead of read-modify-write) would lose the workspace
      // linkage and the in-flight item counter.
      await db.refreshSessions.put(
        makeRefreshSession({
          id: SESSION_ID,
          workspaceGid: "specific-workspace",
          startedAt: "2026-07-30T12:00:00.000Z",
          itemsRetrieved: 17,
          syncMode: "incremental",
        }),
      );

      const importModule =
        await import("../../src/data/db/repositories/refresh-staging.repository");
      const { refreshStagingRepository } = importModule;

      await refreshStagingRepository.beginStaging(SESSION_ID);
      await refreshStagingRepository.stageUpsert("tasks", [
        makeTask({ gid: "task-1" }),
      ]);

      await refreshStagingRepository.commit(SESSION_ID);

      const session = await db.refreshSessions.get(SESSION_ID);
      expect(session).toMatchObject({
        id: SESSION_ID,
        workspaceGid: "specific-workspace",
        startedAt: "2026-07-30T12:00:00.000Z",
        itemsRetrieved: 17,
        syncMode: "incremental",
        status: "succeeded",
      });
      expect(session?.finishedAt).not.toBeNull();
    });
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

    it("a discard after a successful commit is a no-op (the buffer was already cleared)", async () => {
      await db.refreshSessions.put(makeRefreshSession({ id: SESSION_ID }));

      const importModule =
        await import("../../src/data/db/repositories/refresh-staging.repository");
      const { refreshStagingRepository } = importModule;

      await refreshStagingRepository.beginStaging(SESSION_ID);
      await refreshStagingRepository.stageUpsert("tasks", [
        makeTask({ gid: "task-1" }),
      ]);

      await refreshStagingRepository.commit(SESSION_ID);
      await expect(
        refreshStagingRepository.discard(SESSION_ID),
      ).resolves.toBeUndefined();

      // The successful commit's rows are still present.
      await expect(db.tasks.get("task-1")).resolves.toBeDefined();
    });
  });

  describe("commit() atomicity (FR-022 / FR-068 / Dexie transaction enforcement)", () => {
    it("opens a single Dexie transaction covering every cache store it touches (T02: snapshots + projects + tasks for the backfill reads/writes)", async () => {
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
      // participated in the staging buffer PLUS the snapshot backfill
      // reads/writes (T02, FR-026a, D002):
      //   - `refreshSessions` — the session transition
      //   - `projects` — the in-scope query the backfill runs
      //   - `tasks` — the in-scope query the backfill runs
      //   - `snapshots` — the backfill's `put`
      // Including `snapshots` unconditionally was the D002 fix; a
      // future contributor who narrows the scope to only the staged
      // stores fails this assertion before their partial-apply bug
      // ships (the backfill would throw `Table not in transaction
      // scope` and rollback the whole commit).
      const call = commitTransactions[0];
      const tables = call?.[1] as unknown as string[];
      expect(Array.from(tables).sort()).toEqual(
        ["projects", "refreshSessions", "snapshots", "tasks"].sort(),
      );

      // The single transaction transitions the seeded session to
      // succeeded and stamps a finishedAt.
      const session = await db.refreshSessions.get(SESSION_ID);
      expect(session?.status).toBe("succeeded");
      expect(session?.finishedAt).not.toBeNull();
    });

    it("backfills the daily Snapshot row for the session's workspace with the in-scope metrics (FR-026a, T02)", async () => {
      // T02 — the snapshot backfill runs inside the commit transaction
      // so a mid-batch throw on any path (cache flush, session
      // transition, or backfill itself) rolls back the whole batch.
      await seedPreStagingState();

      const importModule =
        await import("../../src/data/db/repositories/refresh-staging.repository");
      const { refreshStagingRepository } = importModule;

      await refreshStagingRepository.beginStaging(SESSION_ID);
      // Stage one new task (completedAt=null → counts as incomplete)
      // and an estimated-minutes value on the seeded task so we can
      // pin the backfill's expected sums.
      await refreshStagingRepository.stageUpsert("tasks", [
        makeTask({
          gid: "task-new-incomplete",
          projectGids: ["proj-active"],
          estimatedMinutes: 90,
        }),
        makeTask({
          gid: "task-new-incomplete-unestimated",
          projectGids: ["proj-active"],
          estimatedMinutes: null,
        }),
      ]);

      await refreshStagingRepository.commit(SESSION_ID);

      // The backfilled row is keyed by the session's workspaceGid and
      // the localCalendarDate the commit derived from `new Date()`.
      // The seeded pre-staging tasks contribute three incomplete
      // default_tasks (task-active, task-subtask, task-multi-project);
      // the two staged tasks contribute another two. task-completed
      // and task-archived-project are excluded by the predicate. The
      // unestimated count includes the three seeded tasks (all
      // estimatedMinutes=null) plus the one new unestimated task.
      const snapshots = await db.snapshots
        .where("[workspaceGid+localCalendarDate]")
        .between(
          [WORKSPACE_GID, "0000-01-01"],
          [WORKSPACE_GID, "9999-12-31"],
        )
        .toArray();

      // Exactly ONE snapshot row exists for the workspace — the
      // FR-026a compound-key dedup invariant. A second same-day
      // refresh will REPLACE (not duplicate) this row.
      expect(snapshots).toHaveLength(1);
      const snapshot = snapshots[0];
      expect(snapshot?.workspaceGid).toBe(WORKSPACE_GID);
      expect(snapshot?.localCalendarDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(snapshot?.computedFromRefreshId).toBe(SESSION_ID);
      expect(snapshot?.incompleteCount).toBe(5);
      expect(snapshot?.incompleteEstimatedMinutes).toBe(90);
      expect(snapshot?.unestimatedIncompleteCount).toBe(4);
      expect(typeof snapshot?.computedAt).toBe("string");
    });

    it("replaces the existing Snapshot row on same-day re-refresh (FR-026a replace-not-duplicate)", async () => {
      // FR-026a — a second same-day refresh in the same timezone
      // REPLACES the prior row's metrics instead of producing a
      // duplicate. Dexie's compound-key upsert via `put` is the
      // enforcement mechanism; the assertion pins the row count and
      // confirms the second commit's metrics overwrote the first's.
      const FIRST_SESSION_ID = "session-first-refresh";
      const SECOND_SESSION_ID = "session-second-refresh";

      // Seed one in-scope task with a known estimated-minutes value
      // so both commits produce a non-zero metric.
      await cacheRepository.upsertProjects([
        makeProject({ gid: "proj-active" }),
      ]);
      await cacheRepository.upsertTasks([
        makeTask({
          gid: "task-active",
          projectGids: ["proj-active"],
          estimatedMinutes: 45,
        }),
      ]);

      const importModule =
        await import("../../src/data/db/repositories/refresh-staging.repository");
      const { refreshStagingRepository } = importModule;

      // First refresh — backfills incompleteCount=1,
      // incompleteEstimatedMinutes=45, unestimatedIncompleteCount=0.
      await db.refreshSessions.put(
        makeRefreshSession({ id: FIRST_SESSION_ID }),
      );
      await refreshStagingRepository.beginStaging(FIRST_SESSION_ID);
      await refreshStagingRepository.stageUpsert("tasks", [
        makeTask({
          gid: "task-new-first",
          projectGids: ["proj-active"],
          estimatedMinutes: 30,
        }),
      ]);
      await refreshStagingRepository.commit(FIRST_SESSION_ID);

      // Second refresh same day — backfills with metrics that
      // OVERWRITE the first row's metrics (still one row at the
      // compound key, not two).
      await db.refreshSessions.put(
        makeRefreshSession({
          id: SECOND_SESSION_ID,
          workspaceGid: WORKSPACE_GID,
        }),
      );
      await refreshStagingRepository.beginStaging(SECOND_SESSION_ID);
      await refreshStagingRepository.stageUpsert("tasks", [
        makeTask({
          gid: "task-new-second",
          projectGids: ["proj-active"],
          estimatedMinutes: null,
        }),
      ]);
      await refreshStagingRepository.commit(SECOND_SESSION_ID);

      const rowsForWorkspace = await db.snapshots
        .where("[workspaceGid+localCalendarDate]")
        .between(
          [WORKSPACE_GID, "0000-01-01"],
          [WORKSPACE_GID, "9999-12-31"],
        )
        .toArray();

      expect(rowsForWorkspace).toHaveLength(1);
      const row = rowsForWorkspace[0];
      expect(row?.computedFromRefreshId).toBe(SECOND_SESSION_ID);
      // After the second refresh: the original `task-active`
      // (45 min) + `task-new-first` (30 min) + `task-new-second`
      // (null) = 3 incomplete, 75 min estimated, 1 unestimated.
      expect(row?.incompleteCount).toBe(3);
      expect(row?.incompleteEstimatedMinutes).toBe(75);
      expect(row?.unestimatedIncompleteCount).toBe(1);
    });

    it("rolls back the snapshot row when the commit transaction throws (T02, D002 atomicity)", async () => {
      // D002 — the snapshot MUST live in the same Dexie transaction
      // as the cache flush, so a mid-batch throw leaves no orphaned
      // snapshot row for a refresh whose cache never committed. The
      // test seeds a snapshot row from a prior successful refresh,
      // triggers a mid-commit throw, and asserts the snapshot row is
      // still the pre-commit value (the commit's mock threw BEFORE
      // the snapshot's `put` would have run, so the seed value is
      // what remains).
      const SESSION_ID_BEFORE = "session-prior-successful";
      const SESSION_ID_FAILED = "session-failed-commit";
      const PRIOR_DATE = "2026-07-30";

      await cacheRepository.upsertProjects([
        makeProject({ gid: "proj-active" }),
      ]);
      await db.snapshots.put(
        makeSnapshot({
          workspaceGid: WORKSPACE_GID,
          localCalendarDate: PRIOR_DATE,
          incompleteCount: 7,
          incompleteEstimatedMinutes: 100,
          unestimatedIncompleteCount: 2,
          computedFromRefreshId: SESSION_ID_BEFORE,
        }),
      );

      const importModule =
        await import("../../src/data/db/repositories/refresh-staging.repository");
      const { refreshStagingRepository } = importModule;

      await db.refreshSessions.put(
        makeRefreshSession({ id: SESSION_ID_FAILED }),
      );
      await refreshStagingRepository.beginStaging(SESSION_ID_FAILED);
      await refreshStagingRepository.stageUpsert("tasks", [
        makeTask({ gid: "task-new-failed", projectGids: ["proj-active"] }),
      ]);

      // Mock tasks.bulkPut to throw mid-batch. The mock fires after
      // the staged tasks land in their first iteration but before
      // the projects flush / session transition / snapshot backfill,
      // so no snapshot row for the failed session reaches the cache.
      vi.spyOn(db.tasks, "bulkPut").mockImplementation(() => {
        throw new Error("Simulated mid-batch failure (snapshot rollback)");
      });

      await expect(
        refreshStagingRepository.commit(SESSION_ID_FAILED),
      ).rejects.toThrow("Simulated mid-batch failure (snapshot rollback)");

      // The pre-existing snapshot from the prior successful refresh
      // is untouched by the rolled-back commit.
      const priorRow = await db.snapshots.get([WORKSPACE_GID, PRIOR_DATE]);
      expect(priorRow).toMatchObject({
        workspaceGid: WORKSPACE_GID,
        localCalendarDate: PRIOR_DATE,
        incompleteCount: 7,
        incompleteEstimatedMinutes: 100,
        unestimatedIncompleteCount: 2,
        computedFromRefreshId: SESSION_ID_BEFORE,
      });

      // No snapshot row exists for the failed session — the backfill
      // never wrote one because the transaction rolled back before
      // the backfill ran.
      const allSnapshots = await db.snapshots.toArray();
      const failedSessionSnapshots = allSnapshots.filter(
        (snapshot) => snapshot.computedFromRefreshId === SESSION_ID_FAILED,
      );
      expect(failedSessionSnapshots).toHaveLength(0);

      // The session status stayed `running` (D002 — the failed
      // commit rolled back the session transition too).
      const failedSession = await db.refreshSessions.get(SESSION_ID_FAILED);
      expect(failedSession?.status).toBe("running");
      expect(failedSession?.finishedAt).toBeNull();
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
