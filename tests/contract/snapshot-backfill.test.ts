/**
 * T085 — `SnapshotRepository.backfillSnapshots` wiring red→green
 * (US5, BSOD-323).
 *
 * Pins the chain `RefreshStagingRepository.commit()` →
 * `SnapshotRepository.backfillSnapshots()` → `calculateBacklogDirection()`:
 * the metric is the SOLE computation path for a derived snapshot row
 * (FR-064 / research.md §11), the backfill is workspace-level and
 * filter-independent, and only a successful commit derives anything
 * (FR-068).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "../../src/data/db/schema";
import type { RefreshSession, Task } from "../../src/data/db/schema";
import { refreshStagingRepository } from "../../src/data/db/repositories/refresh-staging.repository";
import {
  localCalendarDateOf,
  snapshotRepository,
} from "../../src/data/db/repositories/snapshot.repository";
import * as backlog from "../../src/domain/metrics/backlog";

vi.mock("../../src/domain/metrics/backlog", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/domain/metrics/backlog")>();
  return {
    ...actual,
    calculateBacklogDirection: vi.fn(actual.calculateBacklogDirection),
  };
});

const WORKSPACE_GID = "ws-t085";
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 6, 31, 12, 0, 0);

function localNoon(daysAgo: number): string {
  return new Date(NOW.getTime() - daysAgo * DAY).toISOString();
}

function makeTask(overrides: Partial<Task> & Pick<Task, "gid">): Task {
  return {
    name: overrides.gid,
    assigneeGid: null,
    projectGids: ["p1"],
    parentTaskGid: null,
    resourceSubtype: "default_task",
    createdAt: localNoon(3),
    modifiedAt: localNoon(0),
    completedAt: null,
    dueAt: null,
    priorityOptionId: null,
    estimatedMinutes: null,
    actualMinutes: null,
    dependsOnTaskGids: [],
    lastSeenInScopeAt: localNoon(0),
    outOfScopeReason: null,
    ...overrides,
  };
}

function makeSession(id: string): RefreshSession {
  return {
    id,
    workspaceGid: WORKSPACE_GID,
    startedAt: localNoon(0),
    finishedAt: null,
    status: "running",
    itemsRetrieved: 0,
    errorDetail: null,
    syncMode: "full",
  };
}

async function beginRefresh(id: string, tasks: Task[]): Promise<void> {
  await db.refreshSessions.put(makeSession(id));
  await refreshStagingRepository.beginStaging(id);
  await refreshStagingRepository.stageUpsert("tasks", tasks);
}

const TASKS = [
  // created 3 days ago, still open, 60 min
  makeTask({ gid: "a", estimatedMinutes: 60 }),
  // created 3 days ago, completed 1 day ago, 30 min
  makeTask({
    gid: "b",
    estimatedMinutes: 30,
    completedAt: localNoon(1),
  }),
  // created 2 days ago, open, unestimated
  makeTask({ gid: "c", createdAt: localNoon(2) }),
  // no longer in scope — must not count
  makeTask({ gid: "d", outOfScopeReason: "deleted", estimatedMinutes: 999 }),
];

describe("T085 [US5] snapshot backfill wiring", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    vi.mocked(backlog.calculateBacklogDirection).mockClear();
    await Promise.all([
      db.tasks.clear(),
      db.snapshots.clear(),
      db.refreshSessions.clear(),
    ]);
    return () => vi.useRealTimers();
  });

  it("derives every snapshot row from calculateBacklogDirection on a successful commit", async () => {
    const backfillSpy = vi.spyOn(snapshotRepository, "backfillSnapshots");
    await beginRefresh("s1", TASKS);
    await refreshStagingRepository.commit("s1");

    expect(backfillSpy).toHaveBeenCalledTimes(1);
    expect(backfillSpy.mock.calls[0]?.[0]).toBe(WORKSPACE_GID);

    // Sole computation path, workspace-level: NO user filter, and the
    // range is the cached tasks' own span (earliest created → today).
    expect(backlog.calculateBacklogDirection).toHaveBeenCalledTimes(1);
    const [tasks, filter, context, range] = vi.mocked(
      backlog.calculateBacklogDirection,
    ).mock.calls[0]!;
    expect(filter).toEqual({});
    expect(new Date(context.now).getTime()).toBe(NOW.getTime());
    expect(context.timezone).toBe("local");
    expect(tasks.map((t) => t.gid).sort()).toEqual(["a", "b", "c"]);
    expect(range).toEqual({
      start: localCalendarDateOf(new Date(localNoon(3))),
      end: localCalendarDateOf(NOW),
    });

    // Rows are the metric's points, field-mapped, stamped by the commit.
    const rows = await db.snapshots.toArray();
    expect(
      rows
        .map((r) => [
          r.localCalendarDate,
          r.incompleteCount,
          r.incompleteEstimatedMinutes,
          r.unestimatedIncompleteCount,
        ])
        .sort(),
    ).toEqual([
      ["2026-07-28", 2, 90, 0],
      ["2026-07-29", 3, 90, 1],
      ["2026-07-30", 2, 60, 1],
      ["2026-07-31", 2, 60, 1],
    ]);
    for (const row of rows) {
      expect(row.workspaceGid).toBe(WORKSPACE_GID);
      expect(row.computedFromRefreshId).toBe("s1");
      expect(row.computedAt).toBe(NOW.toISOString());
    }
  });

  it("derives nothing when the refresh is discarded (FR-068)", async () => {
    await beginRefresh("s2", TASKS);
    await refreshStagingRepository.discard("s2");

    expect(backlog.calculateBacklogDirection).not.toHaveBeenCalled();
    expect(await db.snapshots.count()).toBe(0);
  });
});
