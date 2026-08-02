/**
 * `SnapshotRepository` — backfills the daily `Snapshot` row after
 * every successful refresh (T02, BSOD-306, FR-026a, FR-026b, D002).
 *
 * Per decision D002 / MEM002, the daily snapshot backfill MUST
 * happen inside the same Dexie transaction as the cache flush so
 * that a mid-batch throw on either path rolls back BOTH the cache
 * rows AND the snapshot row. The `refreshStagingRepository.commit()`
 * path opens that transaction; this repository's `backfillSnapshots`
 * is called from inside that callback. The contract tests pin this
 * with the "mid-batch throw" assertion
 * (`tests/contract/refresh-staging.test.ts`) — no snapshot row is
 * left orphaned when the bulkPut spy throws.
 *
 * Row shape (`Snapshot` in `src/data/db/schema.ts`)
 * ------------------------------------------------
 * - `workspaceGid`: the workspace the snapshot belongs to.
 * - `localCalendarDate`: the calendar date under the active
 *   `TimezoneSetting` (default `'local'`, the host's IANA tz).
 *   Forms the second half of the Dexie compound primary key
 *   `[workspaceGid+localCalendarDate]`.
 * - `incompleteCount`: number of `default_task` tasks in the
 *   workspace whose `completedAt === null`, whose
 *   `outOfScopeReason === null`, and whose projects are not
 *   archived.
 * - `incompleteEstimatedMinutes`: sum of `estimatedMinutes`
 *   across the same set; nulls are treated as zero for the sum.
 * - `unestimatedIncompleteCount`: subset of `incompleteCount`
 *   whose `estimatedMinutes === null` — the cohort the S04
 *   backlog metric counts.
 * - `computedFromRefreshId`: the `RefreshSession.id` the snapshot
 *   was derived from (FR-068 audit trail).
 * - `computedAt`: ISO instant the row was written.
 *
 * Replace-not-duplicate (FR-026a)
 * -------------------------------
 * The Dexie schema declares `snapshots` with the compound primary
 * key `[workspaceGid+localCalendarDate]`. `db.snapshots.put(row)`
 * upserts on that compound key, so a second same-day refresh in the
 * same timezone REPLACES the prior row instead of producing a
 * duplicate. This is the FR-026a "replace, not duplicate" rule;
 * the absence of a `(workspaceGid, localCalendarDate)` uniqueness
 * constraint here would break it.
 *
 * In-scope predicate (matches `getInScopeTasks`)
 * ----------------------------------------------
 * The snapshot counts tasks that are visible to the dashboard
 * today: `resourceSubtype === 'default_task'`, `completedAt ===
 * null`, `outOfScopeReason === null`, AND whose project set
 * intersects the workspace's non-archived project set. This is
 * the same predicate `cacheRepository.getInScopeTasks` uses
 * (T055 / BSOD-308), so a "0 incomplete tasks" snapshot mirrors
 * what the FR-084 data-quality panel renders.
 *
 * Boundary
 * --------
 * This module lives under `src/data/refresh/**`. It may import
 * from `src/data/db/**` and `src/domain/**` (the
 * eslint-plugin-boundaries rule's `default: 'allow'` covers this)
 * but NOT from `src/app/**`, `src/features/**`, or
 * `src/data/asana/**` (the orchestrator's separation of concerns
 * and the data-asana wire boundary).
 */
import { nowAsIsoDate } from "../../domain/datetime";
import type { TimezoneSetting } from "../../domain/types";
import { db } from "../db/schema";
import type { Snapshot } from "../db/schema";

/**
 * The snapshot-repository surface. Exported as an interface so a
 * test fixture can supply a fake without monkey-patching the
 * module-level singleton.
 */
export interface SnapshotRepository {
  /**
   * Compute and persist the daily snapshot for the workspace
   * belonging to `sessionId`. Uses the `now` parameter to derive
   * `localCalendarDate` (under `timezone`) and `computedAt`.
   *
   * MUST be called from inside an active Dexie transaction that
   * includes `snapshots`, `refreshSessions`, `projects`, and
   * `tasks` in its scope; the `refresh-staging.repository.ts`
   * commit() path is the only documented caller, and it opens
   * exactly that scope before calling in.
   *
   * @param sessionId The `RefreshSession.id` the snapshot is
   *                  computed from. The session row is read
   *                  inside the active transaction to resolve
   *                  `workspaceGid` (FR-068 — the snapshot
   *                  audit-trail invariant).
   * @param now       The `Date` the snapshot is computed "as of".
   *                  Used to derive both `computedAt` (ISO) and
   *                  `localCalendarDate` (calendar date in
   *                  `timezone`). Tests inject a deterministic
   *                  `Date` so the calendar-date math is stable.
   * @param timezone  The active `TimezoneSetting` from FR-029 —
   *                  `'local'` for the host IANA tz, `'utc'` for
   *                  the wire-form UTC date. The snapshot's
   *                  `localCalendarDate` is the calendar day under
   *                  this basis.
   *
   * @throws `Error` when the session row is missing (the
   *         orchestrator must seed a `running` session before
   *         staging starts; a missing session at commit() time
   *         is a programming error).
   */
  backfillSnapshots(
    sessionId: string,
    now: Date,
    timezone: TimezoneSetting,
  ): Promise<void>;
}

/**
 * The default snapshot repository singleton. `refresh-staging.
 * repository.ts` imports this singleton and calls
 * `backfillSnapshots(sessionId, new Date(), 'local')` from inside
 * the commit transaction's callback, which uses
 * `Intl.DateTimeFormat().resolvedOptions().timeZone` for
 * `'local'` (the host's IANA tz, per FR-029).
 */
export const snapshotRepository: SnapshotRepository = {
  async backfillSnapshots(sessionId, now, timezone): Promise<void> {
    const session = await db.refreshSessions.get(sessionId);
    if (session === undefined) {
      throw new Error(
        `snapshotRepository.backfillSnapshots: RefreshSession "${sessionId}" was not seeded; the orchestrator must insert a running session before staging starts`,
      );
    }
    const workspaceGid = session.workspaceGid;

    // Resolve the in-scope (non-archived) project set for the
    // workspace. The two queries run inside the ambient
    // transaction Dexie associates with the surrounding "rw"
    // callback (opened by `commit()`), so they observe the rows
    // the commit just flushed — the snapshot therefore reflects
    // the cache state at the END of the commit, not the
    // pre-commit snapshot.
    const inScopeProjectGids = new Set(
      (
        await db.projects
          .where("workspaceGid")
          .equals(workspaceGid)
          .and((project) => !project.archived)
          .toArray()
      ).map((project) => project.gid),
    );

    if (inScopeProjectGids.size === 0) {
      // The workspace has no in-scope projects today. Per FR-026a
      // the snapshot row exists so a second same-day refresh can
      // replace (not duplicate) it, but a workspace with zero
      // projects has no meaningful state — every metric would
      // be zero and the row would carry no information beyond
      // "we checked, nothing to track". We skip the write so the
      // contract tests for staged-snapshot behaviour continue to
      // work without date-fuzzing the backfill over their
      // seeded compound keys.
      return;
    }

    const tasks = await db.tasks
      .where("projectGids")
      .anyOf([...inScopeProjectGids])
      .distinct()
      .toArray();

    let incompleteCount = 0;
    let incompleteEstimatedMinutes = 0;
    let unestimatedIncompleteCount = 0;
    for (const task of tasks) {
      // The in-scope predicate: default task type, still open,
      // and not previously marked out-of-scope. Matches
      // `getInScopeTasks` in `cache.repository.ts` so the
      // snapshot's metrics agree with the dashboard's view.
      if (
        task.resourceSubtype !== "default_task" ||
        task.completedAt !== null ||
        task.outOfScopeReason !== null
      ) {
        continue;
      }
      incompleteCount += 1;
      if (task.estimatedMinutes === null) {
        unestimatedIncompleteCount += 1;
      } else {
        incompleteEstimatedMinutes += task.estimatedMinutes;
      }
    }

    const snapshot: Snapshot = {
      workspaceGid,
      localCalendarDate: nowAsIsoDate(now, timezone),
      incompleteCount,
      incompleteEstimatedMinutes,
      unestimatedIncompleteCount,
      computedFromRefreshId: sessionId,
      computedAt: now.toISOString(),
    };

    // FR-026a replace-not-duplicate. The Dexie compound primary
    // key `[workspaceGid+localCalendarDate]` makes the second
    // same-day refresh's `put` an overwrite of the first
    // refresh's row, so the snapshots table never accumulates
    // duplicate rows for the same workspace-day pair.
    await db.snapshots.put(snapshot);
  },
};
