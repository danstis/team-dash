/**
 * T058 (BSOD-309) — Ingestion-time normalisation contract (red → green).
 *
 * Spec / contract references
 * --------------------------
 * - **FR-014** ("Workspace & Data Scope"): "the system MUST include
 *   standard tasks and their subtasks, and MUST resolve a subtask's
 *   in-scope project membership consistently even when Asana does not
 *   repeat parent-project metadata directly on the subtask record."
 * - **FR-023** ("Local Cache, Refresh & Snapshot History"): "the
 *   system MUST upsert cached records by Asana `gid`, and MUST only
 *   remove or mark a record as deleted/out-of-scope/inaccessible when
 *   that condition can be determined reliably; a record that merely
 *   fails to appear in a given retrieval MUST NOT be silently
 *   interpreted as completed."
 * - `data-model.md` → "Task" → "Subtask resolution (FR-014)": a
 *   subtask's `projectGids` are resolved from its parent task's
 *   `projectGids` at ingestion time in `data/asana`, "since Asana does
 *   not always repeat project metadata on the subtask record — this
 *   normalisation happens once, at write time, so `domain/` never needs
 *   parent-lookup logic".
 *
 * What this test pins
 * -------------------
 * The wire → cache translation and, above all, the FR-014 membership
 * resolution:
 *
 * 1. A subtask whose wire record carries no project metadata inherits
 *    its parent's project memberships — the case FR-014 names.
 * 2. A subtask that *does* carry its own memberships keeps them and
 *    gains the parent's: the resolution is a union, never a
 *    replacement, so no membership Asana reported is ever dropped.
 * 3. A task without a parent keeps its memberships verbatim.
 * 4. A parent supplied from outside the ingested batch resolves the
 *    subtask too (a parent retrieved in an earlier batch of the same
 *    refresh).
 * 5. An *unknown* parent changes nothing — the resolver never invents
 *    a membership and never marks the row out-of-scope (FR-023).
 * 6. Parent chains resolve transitively and a corrupt parent cycle
 *    terminates instead of recursing forever.
 *
 * The end-to-end proof that the refresh ingestion path applies the
 * resolution is `tests/integration/data/subtask-resolution.test.tsx`.
 */

import { describe, expect, it } from "vitest";

import {
  mergeProjectGids,
  normaliseProject,
  normaliseTask,
  normaliseTasks,
  resolveSubtaskProjectGids,
  type WireTask,
} from "../../../../src/data/asana/normalise";
import type { Task } from "../../../../src/data/db/schema";

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const LAST_SEEN_AT = "2026-07-31T09:00:00.000Z";

const PARENT_GID = "1200000000000200";
const SUBTASK_GID = "1200000000000203";
const WEB_APP_GID = "1200000000000100";
const MOBILE_APP_GID = "1200000000000101";
const ARCHIVED_PROJECT_GID = "1200000000000102";

/**
 * Build a validated Asana task wire row. The helper fills the fields
 * every task carries and lets each test override only the ones it is
 * about — the same discipline the fixture dataset follows, so a test
 * reads as "this is the shape under test" rather than a wall of
 * boilerplate.
 */
function wireTask(overrides: Partial<WireTask> = {}): WireTask {
  return {
    gid: SUBTASK_GID,
    name: "A task",
    resource_type: "task",
    resource_subtype: "default_task",
    created_at: "2026-07-01T09:00:00.000Z",
    modified_at: "2026-07-02T09:00:00.000Z",
    ...overrides,
  };
}

/**
 * Build a cache `Task` row — the shape the resolver consumes as a
 * parent.
 */
function cacheTask(overrides: Partial<Task> = {}): Task {
  return {
    gid: PARENT_GID,
    name: "A task",
    assigneeGid: null,
    projectGids: [],
    parentTaskGid: null,
    resourceSubtype: "default_task",
    createdAt: "2026-07-01T09:00:00.000Z",
    modifiedAt: "2026-07-02T09:00:00.000Z",
    completedAt: null,
    dueAt: null,
    priorityOptionId: null,
    estimatedMinutes: null,
    actualMinutes: null,
    dependsOnTaskGids: [],
    lastSeenInScopeAt: LAST_SEEN_AT,
    outOfScopeReason: null,
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* Wire → cache shape                                                          */
/* -------------------------------------------------------------------------- */

describe("T058 (BSOD-309) — wire → cache normalisation", () => {
  it("collapses a wire project into the cache's flat project row", () => {
    const row = normaliseProject(
      {
        gid: WEB_APP_GID,
        name: "Web App",
        resource_type: "project",
        archived: false,
        workspace: { gid: "workspace-1", resource_type: "workspace" },
        team: { gid: "team-1", name: "Product Engineering" },
      },
      "workspace-1",
    );

    expect(row).toEqual({
      gid: WEB_APP_GID,
      name: "Web App",
      workspaceGid: "workspace-1",
      asanaTeamGid: "team-1",
      portfolioGids: [],
      archived: false,
    });
  });

  it("collapses a wire task into the cache's flat task row", () => {
    const row = normaliseTask(
      wireTask({
        gid: PARENT_GID,
        name: "Launch dashboard",
        assignee: { gid: "user-1", name: "Alex Kim" },
        projects: [
          { gid: WEB_APP_GID, name: "Web App" },
          { gid: MOBILE_APP_GID, name: "Mobile App" },
        ],
        custom_fields: [
          {
            gid: "field-1",
            name: "Estimated Time",
            type: "number",
            number_value: 120,
          },
        ],
        dependencies: [{ gid: "task-9" }],
      }),
      LAST_SEEN_AT,
    );

    expect(row.gid).toBe(PARENT_GID);
    expect(row.projectGids).toEqual([WEB_APP_GID, MOBILE_APP_GID]);
    expect(row.parentTaskGid).toBeNull();
    expect(row.assigneeGid).toBe("user-1");
    expect(row.estimatedMinutes).toBe(120);
    expect(row.dependsOnTaskGids).toEqual(["task-9"]);
    expect(row.lastSeenInScopeAt).toBe(LAST_SEEN_AT);
    expect(row.outOfScopeReason).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* FR-014 — subtask project-membership resolution                              */
/* -------------------------------------------------------------------------- */

describe("T058 (BSOD-309) — FR-014 subtask project-membership resolution", () => {
  it("resolves a subtask's project memberships from its parent's", () => {
    const parent = cacheTask({
      gid: PARENT_GID,
      projectGids: [WEB_APP_GID, MOBILE_APP_GID],
    });
    const subtask = cacheTask({
      gid: SUBTASK_GID,
      projectGids: [],
      parentTaskGid: PARENT_GID,
    });

    const resolved = resolveSubtaskProjectGids([parent, subtask]);
    const resolvedSubtask = resolved.find((row) => row.gid === SUBTASK_GID);

    // FR-014 — "MUST resolve a subtask's in-scope project membership
    // consistently even when Asana does not repeat parent-project
    // metadata directly on the subtask record". The subtask ends up in
    // exactly the parent's projects.
    expect(resolvedSubtask?.projectGids).toEqual([WEB_APP_GID, MOBILE_APP_GID]);
  });

  it("keeps the subtask's own memberships and adds the parent's", () => {
    const parent = cacheTask({
      gid: PARENT_GID,
      projectGids: [WEB_APP_GID],
    });
    const subtask = cacheTask({
      gid: SUBTASK_GID,
      projectGids: [ARCHIVED_PROJECT_GID],
      parentTaskGid: PARENT_GID,
    });

    const resolved = resolveSubtaskProjectGids([parent, subtask]);
    const resolvedSubtask = resolved.find((row) => row.gid === SUBTASK_GID);

    // The resolution is a union: the membership Asana reported on the
    // subtask is never dropped, and the parent's membership is added.
    // Out-of-scope memberships are retained by design — the reporting
    // layer filters them, the cache does not.
    expect(resolvedSubtask?.projectGids).toEqual([
      ARCHIVED_PROJECT_GID,
      WEB_APP_GID,
    ]);
  });

  it("lists a membership that appears in both the subtask and the parent once", () => {
    const parent = cacheTask({
      gid: PARENT_GID,
      projectGids: [WEB_APP_GID, MOBILE_APP_GID],
    });
    const subtask = cacheTask({
      gid: SUBTASK_GID,
      projectGids: [WEB_APP_GID],
      parentTaskGid: PARENT_GID,
    });

    const resolved = resolveSubtaskProjectGids([parent, subtask]);
    const resolvedSubtask = resolved.find((row) => row.gid === SUBTASK_GID);

    expect(resolvedSubtask?.projectGids).toEqual([WEB_APP_GID, MOBILE_APP_GID]);
  });

  it("leaves a task without a parent untouched", () => {
    const task = cacheTask({
      gid: PARENT_GID,
      projectGids: [WEB_APP_GID],
    });

    const resolved = resolveSubtaskProjectGids([task]);

    expect(resolved[0]?.projectGids).toEqual([WEB_APP_GID]);
    // An untouched row is returned by reference so a caller can stage
    // only the rows the resolution actually changed.
    expect(resolved[0]).toBe(task);
  });

  it("resolves from a parent supplied from outside the ingested batch", () => {
    const parent = cacheTask({
      gid: PARENT_GID,
      projectGids: [WEB_APP_GID],
    });
    const subtask = cacheTask({
      gid: SUBTASK_GID,
      projectGids: [],
      parentTaskGid: PARENT_GID,
    });
    const knownParents = new Map<string, Task>([[PARENT_GID, parent]]);

    const resolved = resolveSubtaskProjectGids([subtask], knownParents);
    const resolvedSubtask = resolved.find((row) => row.gid === SUBTASK_GID);

    expect(resolvedSubtask?.projectGids).toEqual([WEB_APP_GID]);
  });

  it("changes nothing when the parent was not retrieved", () => {
    const subtask = cacheTask({
      gid: SUBTASK_GID,
      projectGids: [],
      parentTaskGid: PARENT_GID,
    });

    const resolved = resolveSubtaskProjectGids([subtask]);
    const resolvedSubtask = resolved.find((row) => row.gid === SUBTASK_GID);

    // FR-023 — the resolver never invents a membership and never marks
    // the row out-of-scope; the row keeps exactly what Asana reported.
    expect(resolvedSubtask?.projectGids).toEqual([]);
    expect(resolvedSubtask?.outOfScopeReason).toBeNull();
  });

  it("resolves a parent chain transitively", () => {
    const grandparent = cacheTask({
      gid: "grandparent",
      projectGids: [WEB_APP_GID],
    });
    const parent = cacheTask({
      gid: PARENT_GID,
      projectGids: [],
      parentTaskGid: "grandparent",
    });
    const subtask = cacheTask({
      gid: SUBTASK_GID,
      projectGids: [],
      parentTaskGid: PARENT_GID,
    });

    const resolved = resolveSubtaskProjectGids([grandparent, parent, subtask]);

    expect(resolved.find((row) => row.gid === PARENT_GID)?.projectGids).toEqual(
      [WEB_APP_GID],
    );
    expect(
      resolved.find((row) => row.gid === SUBTASK_GID)?.projectGids,
    ).toEqual([WEB_APP_GID]);
  });

  it("terminates on a corrupt parent cycle", () => {
    const first = cacheTask({
      gid: "first",
      projectGids: [WEB_APP_GID],
      parentTaskGid: "second",
    });
    const second = cacheTask({
      gid: "second",
      projectGids: [MOBILE_APP_GID],
      parentTaskGid: "first",
    });

    const resolved = resolveSubtaskProjectGids([first, second]);

    expect(resolved).toHaveLength(2);
    expect(resolved.every((row) => row.projectGids.length === 2)).toBe(true);
  });

  it("normalises a batch and resolves the subtasks inside it", () => {
    const parentWire = wireTask({
      gid: PARENT_GID,
      name: "Launch dashboard",
      projects: [
        { gid: WEB_APP_GID, name: "Web App" },
        { gid: MOBILE_APP_GID, name: "Mobile App" },
      ],
    });
    const subtaskWire = wireTask({
      gid: SUBTASK_GID,
      name: "Add acceptance tests",
      projects: [],
      parent: { gid: PARENT_GID, name: "Launch dashboard" },
    });

    const rows = normaliseTasks([parentWire, subtaskWire], LAST_SEEN_AT);
    const subtask = rows.find((row) => row.gid === SUBTASK_GID);

    // The batch entry point normalises AND resolves: the subtask
    // inherits the parent's memberships even though its own wire record
    // carried none.
    expect(subtask?.parentTaskGid).toBe(PARENT_GID);
    expect(subtask?.projectGids).toEqual([WEB_APP_GID, MOBILE_APP_GID]);
  });

  it("merges membership lists without duplicates", () => {
    expect(
      mergeProjectGids([WEB_APP_GID], [WEB_APP_GID, MOBILE_APP_GID]),
    ).toEqual([WEB_APP_GID, MOBILE_APP_GID]);
    expect(mergeProjectGids([], [MOBILE_APP_GID])).toEqual([MOBILE_APP_GID]);
  });
});
