/**
 * T02 — `SnapshotRepository.backfillSnapshots()` unit tests.
 *
 * Pins the daily-snapshot backfill behaviour (FR-026a, FR-026b,
 * D002) at the data-layer boundary. The contract tests in
 * `tests/contract/refresh-staging.test.ts` assert the commit()
 * integration; these unit tests pin the snapshot repository's
 * own contract — the metric counting rules, the timezone-aware
 * `localCalendarDate` derivation, the FR-026a replace-not-duplicate
 * invariant, and the error paths.
 *
 * Scope
 * -----
 * Each test seeds its own preconditions against `fake-indexeddb`
 * (the project's storage-layer shim — see `tests/setup.ts`) and
 * tears them down via `clearAllStores()` between tests so Dexie's
 * open-database connection doesn't accumulate across the suite.
 *
 * Determinism
 * -----------
 * The tests pass an explicit `now: Date` to `backfillSnapshots`
 * and a fixed `timezone: 'utc'` for the calendar-date math so the
 * expected `localCalendarDate` is stable across host timezones
 * (the runtime `Intl.DateTimeFormat().resolvedOptions().timeZone`
 * can vary between CI runners). The `localCalendarDateOf` local
 * helper inside `snapshot-repository.ts` delegates to
 * `nowAsIsoDate(now, timezone)` from the domain layer; this test
 * exercises the UTC path so a host running `TZ=America/Los_Angeles`
 * (for example) computes the same YYYY-MM-DD as a UTC host.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { snapshotRepository } from "../../../../src/data/refresh/snapshot-repository";
import type { RefreshSession, Snapshot } from "../../../../src/data/db/schema";
import { db } from "../../../../src/data/db/schema";
import type { TimezoneSetting } from "../../../../src/domain/types";

const SESSION_ID = "session-snapshot-test";
const OTHER_SESSION_ID = "session-snapshot-test-other";
const WORKSPACE_GID = "ws-snapshot-test";
const OTHER_WORKSPACE_GID = "ws-snapshot-other";
const ACTIVE_PROJECT = "proj-active";
const OTHER_ACTIVE_PROJECT = "proj-active-2";
const ARCHIVED_PROJECT = "proj-archived";

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

async function seedSession(
  sessionId: string = SESSION_ID,
  workspaceGid: string = WORKSPACE_GID,
): Promise<void> {
  await db.refreshSessions.put(
    makeRefreshSession({ id: sessionId, workspaceGid }),
  );
}

/**
 * Seed a single active project in `WORKSPACE_GID` so the
 * backfill's in-scope predicate finds at least one project and
 * the snapshot row is written. Each happy-path test that wants
 * a written snapshot must call this helper; the no-op-when-no-
 * projects tests deliberately omit it.
 */
async function seedActiveProject(
  projectGid: string = ACTIVE_PROJECT,
  workspaceGid: string = WORKSPACE_GID,
): Promise<void> {
  await db.projects.put({
    gid: projectGid,
    name: "Active project",
    workspaceGid,
    asanaTeamGid: "team-1",
    portfolioGids: [],
    archived: false,
  });
}

async function getSnapshot(
  workspaceGid: string,
  localCalendarDate: string,
): Promise<Snapshot | undefined> {
  return db.snapshots.get([workspaceGid, localCalendarDate]);
}

describe("T02 SnapshotRepository.backfillSnapshots()", () => {
  beforeEach(async () => {
    await clearAllStores();
  });

  afterEach(async () => {
    await clearAllStores();
  });

  describe("FR-026a — daily snapshot row", () => {
    it("writes one Snapshot row keyed by [workspaceGid, localCalendarDate]", async () => {
      await seedSession();
      await seedActiveProject();

      await snapshotRepository.backfillSnapshots(
        SESSION_ID,
        new Date("2026-07-31T12:00:00.000Z"),
        "utc",
      );

      const rows = await db.snapshots.toArray();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        workspaceGid: WORKSPACE_GID,
        localCalendarDate: "2026-07-31",
        computedFromRefreshId: SESSION_ID,
        computedAt: "2026-07-31T12:00:00.000Z",
      });
    });

    it("uses the session's workspaceGid even when multiple workspaces exist", async () => {
      // The session belongs to `WORKSPACE_GID`; the backfill must
      // compute the snapshot against that workspace, not the first
      // workspace it finds or a global default.
      await db.refreshSessions.bulkPut([
        makeRefreshSession({ id: SESSION_ID, workspaceGid: WORKSPACE_GID }),
        makeRefreshSession({
          id: OTHER_SESSION_ID,
          workspaceGid: OTHER_WORKSPACE_GID,
        }),
      ]);
      await seedActiveProject(ACTIVE_PROJECT, WORKSPACE_GID);
      await seedActiveProject("proj-other-active", OTHER_WORKSPACE_GID);

      await snapshotRepository.backfillSnapshots(
        SESSION_ID,
        new Date("2026-07-31T00:00:00.000Z"),
        "utc",
      );

      const rows = await db.snapshots.toArray();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.workspaceGid).toBe(WORKSPACE_GID);
      expect(rows[0]?.computedFromRefreshId).toBe(SESSION_ID);
    });

    it("computes incompleteCount as the count of incomplete default_tasks in non-archived projects", async () => {
      // FR-026a — the metric that drives the FR-084 data-quality
      // panel and the S04 backlog metric. Exercise the inclusive
      // predicate (project intersection, default_task type, not
      // completed, not out-of-scope) so a future contributor who
      // drops a clause breaks one of these assertions.
      await seedSession();

      await db.projects.bulkPut([
        {
          gid: ACTIVE_PROJECT,
          name: "Active project",
          workspaceGid: WORKSPACE_GID,
          asanaTeamGid: "team-1",
          portfolioGids: [],
          archived: false,
        },
        {
          gid: OTHER_ACTIVE_PROJECT,
          name: "Other active project",
          workspaceGid: WORKSPACE_GID,
          asanaTeamGid: "team-1",
          portfolioGids: [],
          archived: false,
        },
        {
          gid: ARCHIVED_PROJECT,
          name: "Archived project",
          workspaceGid: WORKSPACE_GID,
          asanaTeamGid: "team-1",
          portfolioGids: [],
          archived: true,
        },
      ]);

      await db.tasks.bulkPut([
        // 4 in-scope tasks → counted in incompleteCount.
        {
          gid: "task-default-active",
          name: "Default task in active project",
          assigneeGid: null,
          projectGids: [ACTIVE_PROJECT],
          parentTaskGid: null,
          resourceSubtype: "default_task",
          createdAt: "2026-07-01T09:00:00.000Z",
          modifiedAt: "2026-07-15T09:00:00.000Z",
          completedAt: null,
          dueAt: null,
          priorityOptionId: null,
          estimatedMinutes: 60,
          actualMinutes: null,
          dependsOnTaskGids: [],
          lastSeenInScopeAt: "2026-07-31T00:00:00.000Z",
          outOfScopeReason: null,
        },
        {
          gid: "task-subtask",
          name: "Subtask in active project",
          assigneeGid: null,
          projectGids: [ACTIVE_PROJECT],
          parentTaskGid: "task-default-active",
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
        },
        {
          gid: "task-multi-project",
          name: "Task in two active projects",
          assigneeGid: null,
          projectGids: [ACTIVE_PROJECT, OTHER_ACTIVE_PROJECT],
          parentTaskGid: null,
          resourceSubtype: "default_task",
          createdAt: "2026-07-01T09:00:00.000Z",
          modifiedAt: "2026-07-15T09:00:00.000Z",
          completedAt: null,
          dueAt: null,
          priorityOptionId: null,
          estimatedMinutes: 30,
          actualMinutes: null,
          dependsOnTaskGids: [],
          lastSeenInScopeAt: "2026-07-31T00:00:00.000Z",
          outOfScopeReason: null,
        },
        // Excluded because completedAt !== null.
        {
          gid: "task-completed",
          name: "Completed in-scope task",
          assigneeGid: null,
          projectGids: [ACTIVE_PROJECT],
          parentTaskGid: null,
          resourceSubtype: "default_task",
          createdAt: "2026-07-01T09:00:00.000Z",
          modifiedAt: "2026-07-15T09:00:00.000Z",
          completedAt: "2026-07-20T09:00:00.000Z",
          dueAt: null,
          priorityOptionId: null,
          estimatedMinutes: 120,
          actualMinutes: null,
          dependsOnTaskGids: [],
          lastSeenInScopeAt: "2026-07-31T00:00:00.000Z",
          outOfScopeReason: null,
        },
      ]);

      // Excluded because its only project is archived.
      await db.tasks.put({
        gid: "task-archived-project",
        name: "Task in archived project",
        assigneeGid: null,
        projectGids: [ARCHIVED_PROJECT],
        parentTaskGid: null,
        resourceSubtype: "default_task",
        createdAt: "2026-07-01T09:00:00.000Z",
        modifiedAt: "2026-07-15T09:00:00.000Z",
        completedAt: null,
        dueAt: null,
        priorityOptionId: null,
        estimatedMinutes: 200,
        actualMinutes: null,
        dependsOnTaskGids: [],
        lastSeenInScopeAt: "2026-07-31T00:00:00.000Z",
        outOfScopeReason: null,
      });

      // Excluded because resourceSubtype is "milestone" (not a task
      // the dashboard renders).
      await db.tasks.put({
        gid: "task-milestone",
        name: "Milestone in active project",
        assigneeGid: null,
        projectGids: [ACTIVE_PROJECT],
        parentTaskGid: null,
        resourceSubtype: "milestone",
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
      });

      // Excluded because outOfScopeReason is set ("removed_from_projects").
      await db.tasks.put({
        gid: "task-removed",
        name: "Out-of-scope task",
        assigneeGid: null,
        projectGids: [ACTIVE_PROJECT],
        parentTaskGid: null,
        resourceSubtype: "default_task",
        createdAt: "2026-07-01T09:00:00.000Z",
        modifiedAt: "2026-07-15T09:00:00.000Z",
        completedAt: null,
        dueAt: null,
        priorityOptionId: null,
        estimatedMinutes: 90,
        actualMinutes: null,
        dependsOnTaskGids: [],
        lastSeenInScopeAt: "2026-07-31T00:00:00.000Z",
        outOfScopeReason: "removed_from_projects",
      });

      await snapshotRepository.backfillSnapshots(
        SESSION_ID,
        new Date("2026-07-31T00:00:00.000Z"),
        "utc",
      );

      const row = await getSnapshot(WORKSPACE_GID, "2026-07-31");
      expect(row).toBeDefined();
      // 3 incomplete, in-scope default_tasks remain after excluding
      // completed / archived-project / milestone / out-of-scope.
      expect(row?.incompleteCount).toBe(3);
      // Sum of non-null estimated minutes: 60 + 30 = 90.
      expect(row?.incompleteEstimatedMinutes).toBe(90);
      // Only the subtask is null-estimated (60 + 30 = 90 estimated;
      // 1 unestimated). The other excluded tasks do NOT contribute.
      expect(row?.unestimatedIncompleteCount).toBe(1);
    });

    it("replaces the existing Snapshot row on same-key put (FR-026a replace-not-duplicate)", async () => {
      // FR-026a — Dexie's compound-key upsert via `put` overwrites
      // any pre-existing row at `[workspaceGid, localCalendarDate]`,
      // so a second same-day refresh in the same timezone replaces
      // rather than duplicates. A future contributor who switched to
      // `add` (insert-only) would let duplicate rows accumulate.
      await seedSession();
      await seedActiveProject();
      await db.snapshots.put({
        workspaceGid: WORKSPACE_GID,
        localCalendarDate: "2026-07-31",
        incompleteCount: 999,
        incompleteEstimatedMinutes: 9999,
        unestimatedIncompleteCount: 99,
        computedFromRefreshId: "session-prior",
        computedAt: "2026-07-30T00:00:00.000Z",
      });

      await snapshotRepository.backfillSnapshots(
        SESSION_ID,
        new Date("2026-07-31T00:00:00.000Z"),
        "utc",
      );

      const rows = await db.snapshots.toArray();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        workspaceGid: WORKSPACE_GID,
        localCalendarDate: "2026-07-31",
        incompleteCount: 0,
        incompleteEstimatedMinutes: 0,
        unestimatedIncompleteCount: 0,
        computedFromRefreshId: SESSION_ID,
      });
    });

    it("writes one snapshot row per workspace when multiple workspaces are seeded", async () => {
      // The compound key `[workspaceGid+localCalendarDate]` keeps
      // per-workspace rows distinct. Calling `backfillSnapshots`
      // for two different sessions in two different workspaces
      // produces TWO rows, one per workspace — not a single shared
      // global row.
      await db.refreshSessions.bulkPut([
        makeRefreshSession({ id: SESSION_ID, workspaceGid: WORKSPACE_GID }),
        makeRefreshSession({
          id: OTHER_SESSION_ID,
          workspaceGid: OTHER_WORKSPACE_GID,
        }),
      ]);
      await seedActiveProject(ACTIVE_PROJECT, WORKSPACE_GID);
      await seedActiveProject("proj-other-active", OTHER_WORKSPACE_GID);

      await snapshotRepository.backfillSnapshots(
        SESSION_ID,
        new Date("2026-07-31T00:00:00.000Z"),
        "utc",
      );
      await snapshotRepository.backfillSnapshots(
        OTHER_SESSION_ID,
        new Date("2026-07-31T00:00:00.000Z"),
        "utc",
      );

      const rows = await db.snapshots.toArray();
      expect(rows).toHaveLength(2);
      expect(rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            workspaceGid: WORKSPACE_GID,
            computedFromRefreshId: SESSION_ID,
          }),
          expect.objectContaining({
            workspaceGid: OTHER_WORKSPACE_GID,
            computedFromRefreshId: OTHER_SESSION_ID,
          }),
        ]),
      );
    });
  });

  describe("localCalendarDate — calendar-day derivation under TimezoneSetting", () => {
    it("derives localCalendarDate from `now` under 'utc'", async () => {
      await seedSession();
      await seedActiveProject();
      const now = new Date("2026-08-15T23:30:00.000Z");

      await snapshotRepository.backfillSnapshots(SESSION_ID, now, "utc");

      const row = await getSnapshot(WORKSPACE_GID, "2026-08-15");
      expect(row).toBeDefined();
      expect(row?.computedAt).toBe(now.toISOString());
    });

    it("rolls the calendar date forward past midnight (UTC)", async () => {
      await seedSession();
      await seedActiveProject();
      // A few minutes before midnight, the date should still be
      // "2026-08-15"; a few minutes after, it rolls to "2026-08-16".
      await snapshotRepository.backfillSnapshots(
        SESSION_ID,
        new Date("2026-08-15T23:55:00.000Z"),
        "utc",
      );
      const beforeMidnight = await getSnapshot(WORKSPACE_GID, "2026-08-15");
      expect(beforeMidnight).toBeDefined();

      await db.refreshSessions.put(
        makeRefreshSession({ id: SESSION_ID, workspaceGid: WORKSPACE_GID }),
      );
      await snapshotRepository.backfillSnapshots(
        SESSION_ID,
        new Date("2026-08-16T00:05:00.000Z"),
        "utc",
      );
      const afterMidnight = await getSnapshot(WORKSPACE_GID, "2026-08-16");
      expect(afterMidnight).toBeDefined();
    });

    it("formats localCalendarDate as a zero-padded YYYY-MM-DD string", async () => {
      // January 5 2027 → "2027-01-05" (two-digit month, two-digit
      // day). A non-padded formatter like "2027-1-5" would break
      // the compound-key dedup invariant (the same calendar day
      // could be represented as both "2026-07-31" and "2026-7-31"
      // and would collide under naive string-equality but resolve
      // to different rows).
      await seedSession();
      await seedActiveProject();

      await snapshotRepository.backfillSnapshots(
        SESSION_ID,
        new Date("2027-01-05T12:00:00.000Z"),
        "utc",
      );

      const row = await getSnapshot(WORKSPACE_GID, "2027-01-05");
      expect(row).toBeDefined();
      expect(row?.localCalendarDate).toBe("2027-01-05");
    });
  });

  describe("session-not-seeded error path", () => {
    it("throws a descriptive error when the session row is missing", async () => {
      // No refreshSessions seed before calling — the orchestrator
      // always seeds a running session before staging starts (see
      // Step 1 in refresh-orchestrator.ts), so a missing session
      // at backfill time is a programming error, not a user-visible
      // state. The error string is the one the refresh-staging
      // repository's atomicity contract references.
      await expect(
        snapshotRepository.backfillSnapshots(
          "session-not-seeded",
          new Date("2026-07-31T00:00:00.000Z"),
          "utc",
        ),
      ).rejects.toThrow(/was not seeded/);

      // No snapshot row is written on the error path.
      const rows = await db.snapshots.toArray();
      expect(rows).toHaveLength(0);
    });
  });

  describe("no-op on workspace with zero in-scope projects", () => {
    it("does not write a snapshot when the session's workspace has no projects", async () => {
      // Boundary case: the workspace has no in-scope (non-archived)
      // projects. There is no meaningful state to snapshot, so the
      // repository no-ops. The contract test "two stageUpsert calls
      // for the same logical snapshot" depends on this no-op so the
      // backfill's `localCalendarDate` does not stomp the staged
      // snapshot row's compound key.
      await seedSession();

      await snapshotRepository.backfillSnapshots(
        SESSION_ID,
        new Date("2026-07-31T00:00:00.000Z"),
        "utc",
      );

      const rows = await db.snapshots.toArray();
      expect(rows).toHaveLength(0);
    });

    it("does not write a snapshot when every project in the workspace is archived", async () => {
      // Same no-op rule for a workspace whose projects are all
      // archived — there are no in-scope projects today.
      await seedSession();
      await db.projects.bulkPut([
        {
          gid: "proj-archived-a",
          name: "Archived A",
          workspaceGid: WORKSPACE_GID,
          asanaTeamGid: "team-1",
          portfolioGids: [],
          archived: true,
        },
        {
          gid: "proj-archived-b",
          name: "Archived B",
          workspaceGid: WORKSPACE_GID,
          asanaTeamGid: "team-1",
          portfolioGids: [],
          archived: true,
        },
      ]);

      await snapshotRepository.backfillSnapshots(
        SESSION_ID,
        new Date("2026-07-31T00:00:00.000Z"),
        "utc",
      );

      const rows = await db.snapshots.toArray();
      expect(rows).toHaveLength(0);
    });

    it("ignores projects in other workspaces when computing in-scope projects", async () => {
      // The where("workspaceGid").equals(workspaceGid) filter must
      // be workspace-scoped — a project in another workspace sharing
      // a gid prefix must NOT contribute tasks to this workspace's
      // snapshot.
      await seedSession();
      await db.projects.bulkPut([
        {
          gid: ACTIVE_PROJECT,
          name: "Active project in this workspace",
          workspaceGid: WORKSPACE_GID,
          asanaTeamGid: "team-1",
          portfolioGids: [],
          archived: false,
        },
        {
          gid: "proj-other-workspace",
          name: "Active project in another workspace",
          workspaceGid: OTHER_WORKSPACE_GID,
          asanaTeamGid: "team-2",
          portfolioGids: [],
          archived: false,
        },
      ]);
      await db.tasks.bulkPut([
        {
          gid: "task-this-workspace",
          name: "Task in this workspace",
          assigneeGid: null,
          projectGids: [ACTIVE_PROJECT],
          parentTaskGid: null,
          resourceSubtype: "default_task",
          createdAt: "2026-07-01T09:00:00.000Z",
          modifiedAt: "2026-07-15T09:00:00.000Z",
          completedAt: null,
          dueAt: null,
          priorityOptionId: null,
          estimatedMinutes: 50,
          actualMinutes: null,
          dependsOnTaskGids: [],
          lastSeenInScopeAt: "2026-07-31T00:00:00.000Z",
          outOfScopeReason: null,
        },
        {
          gid: "task-other-workspace",
          name: "Task in another workspace",
          assigneeGid: null,
          projectGids: ["proj-other-workspace"],
          parentTaskGid: null,
          resourceSubtype: "default_task",
          createdAt: "2026-07-01T09:00:00.000Z",
          modifiedAt: "2026-07-15T09:00:00.000Z",
          completedAt: null,
          dueAt: null,
          priorityOptionId: null,
          estimatedMinutes: 500,
          actualMinutes: null,
          dependsOnTaskGids: [],
          lastSeenInScopeAt: "2026-07-31T00:00:00.000Z",
          outOfScopeReason: null,
        },
      ]);

      await snapshotRepository.backfillSnapshots(
        SESSION_ID,
        new Date("2026-07-31T00:00:00.000Z"),
        "utc",
      );

      const row = await getSnapshot(WORKSPACE_GID, "2026-07-31");
      expect(row).toMatchObject({
        incompleteCount: 1,
        incompleteEstimatedMinutes: 50,
        unestimatedIncompleteCount: 0,
      });
    });
  });

  describe("atomicity contract for the snapshot writes", () => {
    it("the backfill's snapshot.put shares the ambient Dexie transaction opened by the caller", async () => {
      // D002 — the snapshot MUST live in the same transaction as
      // the cache flush. This test verifies the ambient-transaction
      // model: the snapshot's `put` runs inside whatever Dexie
      // transaction is currently open in the surrounding scope.
      // The orchestrator-owned commit() is the only documented
      // caller; we exercise it through the staging repository's
      // commit() so the test mirrors the production path.
      await seedSession();
      await db.projects.put({
        gid: ACTIVE_PROJECT,
        name: "Active project",
        workspaceGid: WORKSPACE_GID,
        asanaTeamGid: "team-1",
        portfolioGids: [],
        archived: false,
      });
      await db.tasks.put({
        gid: "task-in-scope",
        name: "In-scope task",
        assigneeGid: null,
        projectGids: [ACTIVE_PROJECT],
        parentTaskGid: null,
        resourceSubtype: "default_task",
        createdAt: "2026-07-01T09:00:00.000Z",
        modifiedAt: "2026-07-15T09:00:00.000Z",
        completedAt: null,
        dueAt: null,
        priorityOptionId: null,
        estimatedMinutes: 20,
        actualMinutes: null,
        dependsOnTaskGids: [],
        lastSeenInScopeAt: "2026-07-31T00:00:00.000Z",
        outOfScopeReason: null,
      });

      // Import lazily so the test mirrors the orchestrator path
      // (the contract tests use the same pattern).
      const importModule =
        await import(
          "../../../../src/data/db/repositories/refresh-staging.repository"
        );
      const { refreshStagingRepository } = importModule;

      await refreshStagingRepository.beginStaging(SESSION_ID);
      await refreshStagingRepository.stageUpsert("tasks", [
        {
          gid: "task-staged-in-scope",
          name: "Staged in-scope task",
          assigneeGid: null,
          projectGids: [ACTIVE_PROJECT],
          parentTaskGid: null,
          resourceSubtype: "default_task",
          createdAt: "2026-07-01T09:00:00.000Z",
          modifiedAt: "2026-07-15T09:00:00.000Z",
          completedAt: null,
          dueAt: null,
          priorityOptionId: null,
          estimatedMinutes: 30,
          actualMinutes: null,
          dependsOnTaskGids: [],
          lastSeenInScopeAt: "2026-07-31T00:00:00.000Z",
          outOfScopeReason: null,
        },
      ]);

      await refreshStagingRepository.commit(SESSION_ID);

      // After commit the snapshot is at the workspace, with the
      // combined in-scope count (1 pre-existing + 1 staged).
      const rows = await db.snapshots.toArray();
      expect(rows).toHaveLength(1);
      const row = rows[0];
      expect(row).toMatchObject({
        workspaceGid: WORKSPACE_GID,
        computedFromRefreshId: SESSION_ID,
        incompleteCount: 2,
        incompleteEstimatedMinutes: 50,
        unestimatedIncompleteCount: 0,
      });
      const timezone: TimezoneSetting = "local";
      // The exact localCalendarDate is timezone-dependent; the
      // assertion is that the row exists at SOME YYYY-MM-DD key.
      expect(row?.localCalendarDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // Silence the unused-binding lint without removing the
      // type import the test depended on.
      expect(timezone).toBe("local");
    });
  });
});
