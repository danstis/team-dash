/**
 * BSOD-307 (T053) — the read side of the refresh-session store.
 *
 * The refresh orchestrator WRITES the `RefreshSession` rows (the
 * FR-068 audit trail: when the refresh started, when it finished,
 * whether it succeeded, how many items it retrieved). Nothing read
 * them back until T053: the dashboard's refresh-status surface has
 * to tell the user whether the data on screen is cached or fresh and
 * when the workspace was last refreshed successfully (FR-021), and the
 * only durable record of that is the committed session row.
 *
 * Why a repository and not a direct Dexie read
 * --------------------------------------------
 * Constitution Principle VI: every storage access goes through a
 * repository, so a feature component never touches the Dexie schema
 * directly. This module is that repository — it owns the query, the
 * "successful" definition, and the ordering rule, so a future
 * surface (or a second dashboard view) cannot ask the store a
 * slightly different question and get a slightly different answer.
 *
 * What "the last successful refresh" means here
 * ----------------------------------------------
 * - The session belongs to the workspace the user selected. A refresh
 *   of another workspace says nothing about the data on screen.
 * - The session SUCCEEDED. A cancelled, failed, or partially failed
 *   refresh never replaced the cache (FR-022), so it must never be
 *   reported as the refresh the current data came from.
 * - The session FINISHED. A session still marked `'running'` has no
 *   completion timestamp and is therefore not a refresh the user has
 *   seen succeed.
 *
 * The most recent such session wins; the repository returns `null`
 * when the workspace has never completed a refresh, which is the
 * "no cached data yet" case the caller renders as "run a refresh".
 *
 * Boundary
 * --------
 * `src/data/db/**` is the storage boundary. This module imports the
 * Dexie schema and nothing else — no React, no feature components, no
 * Asana client.
 */
import { db, type RefreshSession } from "../schema";

/**
 * The read surface the dashboard's refresh-status surface consumes.
 */
export interface RefreshSessionRepository {
  /**
   * The most recent completed, successful refresh for the given
   * workspace, or `null` when the workspace has never completed one.
   */
  getLastSuccessful(workspaceGid: string): Promise<RefreshSession | null>;
}

/**
 * The session statuses that count as a completed refresh. Every other
 * status (`'running'`, `'cancelled'`, `'auth_failure'`,
 * `'permission_failure'`, `'rate_limited'`, `'partial_failure'`)
 * describes a refresh that did NOT replace the cache (FR-022), so it
 * must never be reported as the source of the data on screen.
 */
const SUCCESSFUL_STATUS: RefreshSession["status"] = "succeeded";

/**
 * Parse a `RefreshSession.finishedAt` timestamp into a comparable
 * number. Returns `null` for a missing or unparseable value so a
 * malformed row sorts last instead of poisoning the comparison.
 */
function finishedAtMillis(session: RefreshSession): number | null {
  if (session.finishedAt === null) {
    return null;
  }
  const parsed = Date.parse(session.finishedAt);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Build the refresh-session repository.
 */
export function createRefreshSessionRepository(): RefreshSessionRepository {
  return {
    async getLastSuccessful(
      workspaceGid: string,
    ): Promise<RefreshSession | null> {
      const sessions = await db.refreshSessions
        .where("workspaceGid")
        .equals(workspaceGid)
        .filter(
          (session) =>
            session.status === SUCCESSFUL_STATUS &&
            finishedAtMillis(session) !== null,
        )
        .toArray();

      let latest: RefreshSession | null = null;
      let latestMillis = Number.NEGATIVE_INFINITY;
      for (const session of sessions) {
        const millis = finishedAtMillis(session);
        if (millis === null) {
          continue;
        }
        if (millis > latestMillis) {
          latest = session;
          latestMillis = millis;
        }
      }
      return latest;
    },
  };
}

/**
 * The shared refresh-session repository instance.
 */
export const refreshSessionRepository: RefreshSessionRepository =
  createRefreshSessionRepository();
