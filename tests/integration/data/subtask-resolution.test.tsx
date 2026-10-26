/**
 * T058 (BSOD-309) — Subtask project-membership resolution at ingestion
 * (red → green).
 *
 * Spec / contract references
 * --------------------------
 * - **FR-014** ("Workspace & Data Scope"): "the system MUST include
 *   standard tasks and their subtasks, and MUST resolve a subtask's
 *   in-scope project membership consistently even when Asana does not
 *   repeat parent-project metadata directly on the subtask record."
 * - **FR-023**: cached records are keyed by `gid` and are only removed
 *   or marked when the condition can be determined reliably.
 * - `data-model.md` → "Task" → "Subtask resolution (FR-014)": a
 *   subtask's `projectGids` are resolved from its parent task's
 *   `projectGids` at ingestion time, "since Asana does not always
 *   repeat project metadata on the subtask record — this normalisation
 *   happens once, at write time, so `domain/` never needs parent-lookup
 *   logic".
 *
 * What this test pins
 * -------------------
 * The end-to-end ingestion path: a refresh walks the workspace's
 * projects and tasks, normalises every wire row, and writes the result
 * to the local cache. The fixture dataset contains exactly the shape
 * FR-014 is about:
 *
 * - `1200000000000200` ("Launch dashboard") is a standard task in two
 *   projects — `1200000000000100` ("Web App") and `1200000000000101`
 *   ("Mobile App").
 * - `1200000000000203` ("Add acceptance tests") is that task's
 *   **subtask**, and its wire record carries `projects: []` — Asana does
 *   not repeat the parent's project metadata on the subtask.
 *
 * Without the FR-014 resolution the subtask is cached with an empty
 * `projectGids`, the in-scope predicate
 * (`resourceSubtype === 'default_task' AND outOfScopeReason === null AND
 * projectGids.some(pg => isProjectInScope(pg))`) excludes it, and the
 * team's subtask effort silently disappears from every figure the
 * dashboard reports.
 *
 * The assertions are therefore:
 *
 * 1. The refresh succeeds and the subtask row is cached.
 * 2. The cached subtask's `projectGids` are the parent's memberships.
 * 3. The subtask is part of the in-scope task set the reporting layer
 *    reads — the reason FR-014 exists.
 *
 * The unit-level contract for the resolution rules lives in
 * `tests/unit/data/asana/normalise.test.ts`.
 *
 * Red phase
 * ---------
 * The resolution lives in `src/data/asana/normalise.ts` (T058), which
 * does not exist before this row's implementation lands — the suite
 * fails before the implementation and passes unchanged after it
 * (Constitution Principle III, test-first quality).
 *
 * Boundary
 * --------
 * `tests/integration/**` runs against jsdom + `fake-indexeddb` + MSW
 * per `tests/setup.ts`. No browser, no live Asana workspace, no live
 * token (NFR-005). The file keeps the row's documented `.tsx` path even
 * though the flow under test is the data path — the assertions read the
 * cache directly rather than through a React surface.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { smallDatasetWorkspaceGid } from "../../../fixtures/asana/small-dataset/data";
import { db } from "../../../src/data/db/schema";
import { cacheRepository } from "../../../src/data/db/repositories/cache.repository";
import { refreshOrchestrator } from "../../../src/data/refresh/refresh-orchestrator";

/* -------------------------------------------------------------------------- */
/* Fixtures (the small dataset; no live Asana)                                 */
/* -------------------------------------------------------------------------- */

const FIXTURE_TOKEN = "fixture-subtask-resolution-token-1234567890";

const PARENT_GID = "1200000000000200";
const SUBTASK_GID = "1200000000000203";
const WEB_APP_GID = "1200000000000100";
const MOBILE_APP_GID = "1200000000000101";

/* -------------------------------------------------------------------------- */
/* The ingestion path                                                          */
/* -------------------------------------------------------------------------- */

describe("T058 (BSOD-309) — subtask project-membership resolution", () => {
  beforeEach(async () => {
    await db.projects.clear();
    await db.tasks.clear();
    await db.refreshSessions.clear();
  });

  it("caches a subtask with the project memberships of its parent task", async () => {
    const outcome = await refreshOrchestrator.runRefresh({
      workspaceGid: smallDatasetWorkspaceGid,
      token: FIXTURE_TOKEN,
    });

    expect(outcome.status).toBe("succeeded");

    const subtask = await db.tasks.get(SUBTASK_GID);
    const parent = await db.tasks.get(PARENT_GID);

    expect(parent).toBeDefined();
    expect(parent?.projectGids).toEqual([WEB_APP_GID, MOBILE_APP_GID]);

    // FR-014 — the subtask's wire record carries no project metadata,
    // so the memberships are resolved from the parent at ingestion
    // time. The subtask lands in exactly the parent's projects.
    expect(subtask?.parentTaskGid).toBe(PARENT_GID);
    expect(subtask?.projectGids).toEqual([WEB_APP_GID, MOBILE_APP_GID]);
  });

  it("keeps the subtask inside the in-scope task set the dashboard reports", async () => {
    const outcome = await refreshOrchestrator.runRefresh({
      workspaceGid: smallDatasetWorkspaceGid,
      token: FIXTURE_TOKEN,
    });

    expect(outcome.status).toBe("succeeded");

    const inScopeTasks = await cacheRepository.getInScopeTasks(
      smallDatasetWorkspaceGid,
    );
    const inScopeGids = inScopeTasks.map((task) => task.gid);

    // The subtask is a standard task of an in-scope parent, so it is
    // part of the reported work — the in-scope predicate accepts it
    // because its resolved memberships intersect the in-scope projects.
    expect(inScopeGids).toContain(SUBTASK_GID);
    expect(inScopeGids).toContain(PARENT_GID);

    const inScopeSubtask = inScopeTasks.find(
      (task) => task.gid === SUBTASK_GID,
    );
    expect(inScopeSubtask?.projectGids).toEqual([WEB_APP_GID, MOBILE_APP_GID]);
  });
});
