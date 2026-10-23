/**
 * T052 — `SnapshotRepository` red→green (US2, BSOD-306).
 *
 * What this test pins
 * -------------------
 * FR-026a: "On each successful refresh, the system MUST derive and store a
 * daily snapshot as a performance cache …; a second successful refresh on
 * the same calendar day MUST replace that day's cached snapshot rather
 * than creating an additional one."
 *
 * FR-068: "The derived daily snapshot cache MUST NOT be skipped or corrupted
 * by a partial/failed refresh; only a successful refresh produces, replaces,
 * or backfills the cache."
 *
 * The storage invariant this file pins is the **single-snapshot-per-local-
 * calendar-day** rule. The `snapshots` table is keyed by
 * `[workspaceGid+localCalendarDate]` (data-model.md → Snapshot), so the
 * second successful refresh of the same local day MUST REPLACE that day's
 * row — never duplicate it, and never leave the previous refresh's figures
 * behind.
 *
 * What "a successful refresh" means at this boundary
 * --------------------------------------------------
 * A refresh reaches the cache through exactly one path: the
 * `RefreshStagingRepository` cycle the orchestrator (T051) drives —
 * `beginStaging()` → `stageUpsert()` → `commit()`. `commit()` is the ONLY
 * writer of the cache and the ONLY caller of `SnapshotRepository`
 * (contracts/storage-repository.md: "Only ever called from
 * `RefreshStagingRepository.commit()`; never called directly by UI code, so
 * a snapshot can never exist without a corresponding successful
 * RefreshSession"), so driving that cycle IS what a successful refresh means
 * for this row.
 *
 * The refresh's snapshot FIGURES are recorded by staging them
 * (`stageUpsert("snapshots", …)`). Computing those figures from the cached
 * task data is the metric row's job (`calculateBacklogDirection`, wired in
 * by T085), which is why this test supplies the figures itself instead of
 * deriving them from the task cache — this row ships the storage
 * primitive, not the metric.
 *
 * A failed refresh is the same cycle ending in `discard()` — the FR-068
 * "a failed or partial refresh never produces a snapshot" case.
 *
 * Red phase
 * ---------
 * The file imports `src/data/db/repositories/snapshot.repository.ts`, which
 * does not exist until this row's implementation lands — the suite fails
 * with a module-resolution error before the implementation, and passes
 * unchanged after it (Constitution Principle III, test-first quality).
 *
 * Boundary
 * --------
 * `tests/integration/**` runs against jsdom + `fake-indexeddb` (per
 * `tests/setup.ts`). No browser, no live Asana workspace, no live token
 * (NFR-005).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "../../../src/data/db/schema";
import type { RefreshSession, Snapshot } from "../../../src/data/db/schema";
import { refreshStagingRepository } from "../../../src/data/db/repositories/refresh-staging.repository";
import {
  localCalendarDateOf,
  snapshotRepository,
} from "../../../src/data/db/repositories/snapshot.repository";

/* -------------------------------------------------------------------------- */
/* Fixtures (deterministic; no live Asana)                                     */
/* -------------------------------------------------------------------------- */

const WORKSPACE_GID = "ws-t052";

/** The refresh session row the orchestrator seeds before staging starts. */
function makeRefreshSession(id: string): RefreshSession {
  return {
    id,
    workspaceGid: WORKSPACE_GID,
    startedAt: "2026-07-31T00:00:00.000Z",
    finishedAt: null,
    status: "running",
    itemsRetrieved: 0,
    errorDetail: null,
    syncMode: "full",
  };
}

/** A snapshot row as the refresh pipeline records it for one local day. */
function makeSnapshot(
  overrides: Partial<Snapshot> &
    Pick<Snapshot, "workspaceGid" | "localCalendarDate">,
): Snapshot {
  return {
    incompleteCount: 0,
    incompleteEstimatedMinutes: 0,
    unestimatedIncompleteCount: 0,
    computedFromRefreshId: "session-unrecorded",
    computedAt: "2026-07-31T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * Drive one SUCCESSFUL refresh at the storage boundary: seed the session
 * row the orchestrator owns, stage the refresh's rows, and commit. A
 * successful commit is the only path that may write the cache.
 */
async function runSuccessfulRefresh(
  sessionId: string,
  snapshots: readonly Snapshot[],
): Promise<void> {
  await db.refreshSessions.put(makeRefreshSession(sessionId));
  await refreshStagingRepository.beginStaging(sessionId);
  await refreshStagingRepository.stageUpsert("snapshots", [...snapshots]);
  await refreshStagingRepository.commit(sessionId);
}

/**
 * Drive one FAILED refresh at the storage boundary: the rows are staged,
 * then the refresh fails and the staging buffer is discarded. The cache —
 * including the derived snapshot cache — must be untouched.
 */
async function runFailedRefresh(
  sessionId: string,
  snapshots: readonly Snapshot[],
): Promise<void> {
  await db.refreshSessions.put(makeRefreshSession(sessionId));
  await refreshStagingRepository.beginStaging(sessionId);
  await refreshStagingRepository.stageUpsert("snapshots", [...snapshots]);
  await refreshStagingRepository.discard(sessionId);
}

/** Every snapshot row stored for the workspace, ordered by the primary key. */
async function storedSnapshots(): Promise<Snapshot[]> {
  return db.snapshots
    .where("[workspaceGid+localCalendarDate]")
    .between([WORKSPACE_GID, ""], [WORKSPACE_GID, "￿"])
    .toArray();
}

/* -------------------------------------------------------------------------- */
/* Test suite                                                                  */
/* -------------------------------------------------------------------------- */

describe("T052 [US2] same-day snapshot replacement", () => {
  beforeEach(async () => {
    await db.snapshots.clear();
    await db.refreshSessions.clear();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.snapshots.clear();
    await db.refreshSessions.clear();
  });

  it("names the current local calendar day in the snapshot key format", () => {
    // The snapshot key is the LOCAL calendar day (FR-029's default basis,
    // FR-030's snapshot-day boundary). The helper the refresh pipeline
    // uses to name "today" is the same one the storage primitive is keyed
    // by, so the test asserts the format rather than a hard-coded date.
    const now = new Date();
    const localDay = localCalendarDateOf(now);

    expect(localDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(localDay).toBe(
      [
        String(now.getFullYear()),
        String(now.getMonth() + 1).padStart(2, "0"),
        String(now.getDate()).padStart(2, "0"),
      ].join("-"),
    );
  });

  it("replaces the same local calendar day's snapshot on a second successful refresh", async () => {
    const today = localCalendarDateOf(new Date());

    await runSuccessfulRefresh("session-t052-1", [
      makeSnapshot({
        workspaceGid: WORKSPACE_GID,
        localCalendarDate: today,
        incompleteCount: 3,
        incompleteEstimatedMinutes: 120,
        unestimatedIncompleteCount: 1,
        computedFromRefreshId: "session-t052-1",
      }),
    ]);

    await runSuccessfulRefresh("session-t052-2", [
      makeSnapshot({
        workspaceGid: WORKSPACE_GID,
        localCalendarDate: today,
        incompleteCount: 7,
        incompleteEstimatedMinutes: 350,
        unestimatedIncompleteCount: 2,
        computedFromRefreshId: "session-t052-2",
      }),
    ]);

    const rows = await storedSnapshots();

    // FR-026a — "a second successful refresh on the same calendar day MUST
    // replace that day's cached snapshot rather than creating an additional
    // one". Exactly ONE row exists for the day…
    expect(rows).toHaveLength(1);
    expect(rows[0]?.localCalendarDate).toBe(today);

    // …and it is the SECOND refresh's row, verbatim: the replacement is a
    // replacement, not a merge and not a stale leftover.
    expect(rows[0]).toMatchObject({
      workspaceGid: WORKSPACE_GID,
      localCalendarDate: today,
      incompleteCount: 7,
      incompleteEstimatedMinutes: 350,
      unestimatedIncompleteCount: 2,
      computedFromRefreshId: "session-t052-2",
    });

    // The whole table holds the single row — the second refresh did not
    // append a second row under a different key.
    expect(await db.snapshots.toArray()).toHaveLength(1);
  });

  it("records the day's snapshot through the SnapshotRepository from commit()", async () => {
    const today = localCalendarDateOf(new Date());
    const backfillSpy = vi.spyOn(snapshotRepository, "backfillSnapshots");

    await runSuccessfulRefresh("session-t052-3", [
      makeSnapshot({
        workspaceGid: WORKSPACE_GID,
        localCalendarDate: today,
        computedFromRefreshId: "session-t052-3",
      }),
    ]);

    // The snapshot cache is written through the repository, and the
    // repository is called from `commit()` — the only path that may
    // produce a snapshot (FR-068).
    expect(backfillSpy).toHaveBeenCalledTimes(1);
    expect(backfillSpy.mock.calls[0]?.[0]).toBe(WORKSPACE_GID);
    expect(backfillSpy.mock.calls[0]?.[1]).toEqual([today]);
  });

  it("keeps one snapshot row per local calendar day across different days", async () => {
    const today = localCalendarDateOf(new Date());
    const yesterday = localCalendarDateOf(
      new Date(Date.now() - 24 * 60 * 60 * 1000),
    );

    await runSuccessfulRefresh("session-t052-4", [
      makeSnapshot({
        workspaceGid: WORKSPACE_GID,
        localCalendarDate: yesterday,
        computedFromRefreshId: "session-t052-4",
      }),
    ]);

    await runSuccessfulRefresh("session-t052-5", [
      makeSnapshot({
        workspaceGid: WORKSPACE_GID,
        localCalendarDate: today,
        computedFromRefreshId: "session-t052-5",
      }),
    ]);

    const rows = await storedSnapshots();

    // One row per day — the key is (workspace, local calendar day), so a
    // different day is a different row, not a duplicate.
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.localCalendarDate)).toEqual([
      yesterday,
      today,
    ]);
  });

  it("writes the day's snapshot inside the commit's own transaction", async () => {
    const today = localCalendarDateOf(new Date());
    const transactionSpy = vi.spyOn(db, "transaction");

    await runSuccessfulRefresh("session-t052-9", [
      makeSnapshot({
        workspaceGid: WORKSPACE_GID,
        localCalendarDate: today,
        computedFromRefreshId: "session-t052-9",
      }),
    ]);

    // FR-022 / FR-068 — the snapshot rows land in the SAME transaction as
    // the cache flush and the session transition. A snapshot write that
    // opened a transaction of its own would be a second, separately
    // committed write: a failure in the commit would leave the snapshot
    // behind for a refresh that never succeeded.
    const writeTransactions = transactionSpy.mock.calls.filter(
      (call) => call[0] === "rw",
    );
    expect(writeTransactions).toHaveLength(1);

    const rows = await storedSnapshots();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.computedFromRefreshId).toBe("session-t052-9");
  });

  it("does not produce or replace a snapshot when the refresh fails", async () => {
    const today = localCalendarDateOf(new Date());

    await runSuccessfulRefresh("session-t052-6", [
      makeSnapshot({
        workspaceGid: WORKSPACE_GID,
        localCalendarDate: today,
        incompleteCount: 4,
        computedFromRefreshId: "session-t052-6",
      }),
    ]);

    // A failed refresh stages the day's figures and then fails.
    await runFailedRefresh("session-t052-7", [
      makeSnapshot({
        workspaceGid: WORKSPACE_GID,
        localCalendarDate: today,
        incompleteCount: 99,
        computedFromRefreshId: "session-t052-7",
      }),
    ]);

    const rows = await storedSnapshots();

    // FR-068 — "only a successful refresh produces, replaces, or backfills
    // the cache". The failed refresh left the last known-good row alone.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.computedFromRefreshId).toBe("session-t052-6");
    expect(rows[0]?.incompleteCount).toBe(4);

    // And the failed refresh's session row never reached `succeeded`.
    const failedSession = await db.refreshSessions.get("session-t052-7");
    expect(failedSession?.status).toBe("running");
  });

  it("reads the day's snapshot back and reports no snapshot for an unrecorded day", async () => {
    const today = localCalendarDateOf(new Date());

    expect(
      await snapshotRepository.getSnapshot(WORKSPACE_GID, today),
    ).toBeNull();

    await runSuccessfulRefresh("session-t052-8", [
      makeSnapshot({
        workspaceGid: WORKSPACE_GID,
        localCalendarDate: today,
        incompleteCount: 2,
        computedFromRefreshId: "session-t052-8",
      }),
    ]);

    const stored = await snapshotRepository.getSnapshot(WORKSPACE_GID, today);
    expect(stored).toMatchObject({
      workspaceGid: WORKSPACE_GID,
      localCalendarDate: today,
      incompleteCount: 2,
      computedFromRefreshId: "session-t052-8",
    });

    // A day that was never recorded has no snapshot — the derived cache is
    // a cache, not a source of truth (FR-026a), so a missing day is a
    // `null`, never a fabricated row.
    expect(
      await snapshotRepository.getSnapshot(WORKSPACE_GID, "2020-01-01"),
    ).toBeNull();

    // Another workspace's snapshot is a different key entirely.
    expect(await snapshotRepository.getSnapshot("ws-other", today)).toBeNull();
  });
});
