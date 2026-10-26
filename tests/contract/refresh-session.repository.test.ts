/**
 * BSOD-307 (T053) — contract tests for the refresh-session read
 * repository.
 *
 * The repository answers one question: "which refresh produced the
 * data the dashboard is showing right now?" The answer has to be the
 * most recent COMPLETED, SUCCESSFUL refresh of the SELECTED workspace
 * — a refresh that failed, was cancelled, or is still running never
 * replaced the cache (FR-022), so it must never be reported as the
 * source of the data on screen.
 *
 * The tests pin that selection rule, the workspace scoping, and the
 * "no refresh yet" case the dashboard renders as "run a refresh".
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { refreshSessionRepository } from "../../src/data/db/repositories/refresh-session.repository";
import { db, type RefreshSession } from "../../src/data/db/schema";

const WORKSPACE_GID = "ws-1";
const OTHER_WORKSPACE_GID = "ws-2";

/**
 * Build a refresh-session row. The `finishedAt` timestamp is the
 * value the dashboard surfaces as the "last refreshed at" label.
 */
function makeSession(
  overrides: Partial<RefreshSession> & Pick<RefreshSession, "id">,
): RefreshSession {
  return {
    workspaceGid: WORKSPACE_GID,
    startedAt: "2026-07-31T00:00:00.000Z",
    finishedAt: "2026-07-31T00:05:00.000Z",
    status: "succeeded",
    itemsRetrieved: 12,
    errorDetail: null,
    syncMode: "full",
    ...overrides,
  };
}

describe("BSOD-307 (T053) refresh-session repository", () => {
  beforeEach(async () => {
    await db.refreshSessions.clear();
  });

  afterEach(async () => {
    await db.refreshSessions.clear();
  });

  it("returns null when the workspace has never completed a refresh", async () => {
    await expect(
      refreshSessionRepository.getLastSuccessful(WORKSPACE_GID),
    ).resolves.toBeNull();
  });

  it("returns the most recent successful refresh of the workspace", async () => {
    await db.refreshSessions.put(
      makeSession({
        id: "session-older",
        finishedAt: "2026-07-31T00:05:00.000Z",
      }),
    );
    await db.refreshSessions.put(
      makeSession({
        id: "session-newer",
        finishedAt: "2026-07-31T09:30:00.000Z",
      }),
    );

    const session =
      await refreshSessionRepository.getLastSuccessful(WORKSPACE_GID);

    expect(session?.id).toBe("session-newer");
    expect(session?.finishedAt).toBe("2026-07-31T09:30:00.000Z");
  });

  it("ignores a refresh that did not complete successfully", async () => {
    await db.refreshSessions.put(
      makeSession({
        id: "session-succeeded",
        finishedAt: "2026-07-31T00:05:00.000Z",
      }),
    );
    await db.refreshSessions.put(
      makeSession({
        id: "session-cancelled",
        status: "cancelled",
        finishedAt: "2026-07-31T09:30:00.000Z",
      }),
    );
    await db.refreshSessions.put(
      makeSession({
        id: "session-auth-failure",
        status: "auth_failure",
        finishedAt: "2026-07-31T10:00:00.000Z",
      }),
    );
    await db.refreshSessions.put(
      makeSession({
        id: "session-partial",
        status: "partial_failure",
        finishedAt: "2026-07-31T11:00:00.000Z",
      }),
    );

    const session =
      await refreshSessionRepository.getLastSuccessful(WORKSPACE_GID);

    // FR-022 — a failed, cancelled, or partial refresh never replaced
    // the cache, so it is never the answer.
    expect(session?.id).toBe("session-succeeded");
  });

  it("ignores a refresh that is still running", async () => {
    await db.refreshSessions.put(
      makeSession({
        id: "session-running",
        status: "running",
        finishedAt: null,
      }),
    );

    await expect(
      refreshSessionRepository.getLastSuccessful(WORKSPACE_GID),
    ).resolves.toBeNull();
  });

  it("scopes the answer to the selected workspace", async () => {
    await db.refreshSessions.put(
      makeSession({ id: "session-other", workspaceGid: OTHER_WORKSPACE_GID }),
    );

    await expect(
      refreshSessionRepository.getLastSuccessful(WORKSPACE_GID),
    ).resolves.toBeNull();
  });
});
