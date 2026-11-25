/**
 * T085 — live wiring (BSOD-323): one refresh that stages tasks populates
 * the `snapshots` table, and a second same-day refresh replaces rows
 * instead of duplicating them (FR-026a / FR-026b).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "../../../src/data/db/schema";
import type { Task } from "../../../src/data/db/schema";
import { refreshStagingRepository } from "../../../src/data/db/repositories/refresh-staging.repository";

const WS = "ws-t085-int";
const NOW = new Date(2026, 6, 31, 12, 0, 0);
const ago = (d: number): string =>
  new Date(NOW.getTime() - d * 86_400_000).toISOString();

function task(gid: string, createdAt: string, extra: Partial<Task> = {}): Task {
  return {
    gid,
    name: gid,
    assigneeGid: null,
    projectGids: ["p"],
    parentTaskGid: null,
    resourceSubtype: "default_task",
    createdAt,
    modifiedAt: createdAt,
    completedAt: null,
    dueAt: null,
    priorityOptionId: null,
    estimatedMinutes: 15,
    actualMinutes: null,
    dependsOnTaskGids: [],
    lastSeenInScopeAt: createdAt,
    outOfScopeReason: null,
    ...extra,
  };
}

async function refresh(id: string, tasks: Task[]): Promise<void> {
  await db.refreshSessions.put({
    id,
    workspaceGid: WS,
    startedAt: ago(0),
    finishedAt: null,
    status: "running",
    itemsRetrieved: 0,
    errorDetail: null,
    syncMode: "full",
  });
  await refreshStagingRepository.beginStaging(id);
  await refreshStagingRepository.stageUpsert("tasks", tasks);
  await refreshStagingRepository.commit(id);
}

describe("T085 [US5] refresh → snapshots table", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    await Promise.all([
      db.tasks.clear(),
      db.snapshots.clear(),
      db.refreshSessions.clear(),
    ]);
    return () => vi.useRealTimers();
  });

  it("backfills every day from the earliest cached task, then replaces on a same-day refresh", async () => {
    await refresh("r1", [task("a", ago(2))]);
    const first = await db.snapshots
      .orderBy("[workspaceGid+localCalendarDate]")
      .toArray();
    expect(first.map((r) => [r.localCalendarDate, r.incompleteCount])).toEqual([
      ["2026-07-29", 1],
      ["2026-07-30", 1],
      ["2026-07-31", 1],
    ]);

    // Task "a" completes today; "b" is new today.
    await refresh("r2", [
      task("a", ago(2), { completedAt: ago(0) }),
      task("b", ago(0)),
    ]);
    const second = await db.snapshots
      .orderBy("[workspaceGid+localCalendarDate]")
      .toArray();
    expect(second).toHaveLength(3); // replaced, not appended
    expect(second.map((r) => r.incompleteCount)).toEqual([1, 1, 1]);
    expect(second.every((r) => r.computedFromRefreshId === "r2")).toBe(true);
  });
});
