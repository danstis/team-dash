/**
 * BSOD-307 (T053) — the dashboard's refresh-status surface.
 *
 * Spec / contract references
 * --------------------------
 * - FR-021: "on completion MUST show the outcome … along with the
 *   last successful refresh timestamp and whether currently displayed
 *   data is cached or fresh."
 * - FR-087: "the system MUST allow the cached dashboard … to be
 *   viewed while offline, and MUST clearly state that refresh is
 *   unavailable offline."
 *
 * What this surface owns
 * ----------------------
 * The two pieces of truth the dashboard owes the user about the data
 * it is showing:
 *
 * 1. **Is it cached or fresh?** The `<FreshnessBanner />` (T050)
 *    renders the label and the last successful refresh timestamp. The
 *    cached/fresh decision itself is made HERE, because it is the
 *    surface that knows both halves of the question:
 *
 *    - while the browser is offline, whatever is on screen is by
 *      definition cached — it cannot be anything else, because the
 *      refresh path is disabled;
 *    - while the browser is online, the data is fresh only when a
 *      refresh completed during THIS page session. Data that was
 *      loaded from the local cache at boot is cached data even when
 *      the network is up — the app must never present it as current
 *      (Constitution Principle VII: cached information must never be
 *      presented as current).
 *
 * 2. **When was the workspace last refreshed successfully?** The
 *    answer comes from the committed `RefreshSession` row, read
 *    through `refreshSessionRepository`. The banner is omitted
 *    entirely when the workspace has never completed a refresh —
 *    there is no timestamp to show, and inventing one ("never") would
 *    be a fabricated fact.
 *
 * Row ownership
 * -------------
 * - **T050 (BSOD-304)** owns the banner's copy and the offline
 *   Refresh component; this surface composes them, it does not
 *   restate them.
 * - **T049 / T051 (BSOD-303 / BSOD-305)** own the refresh action and
 *   its outcome banner; this surface mounts `<RefreshControls />` and
 *   listens for the completion callback that tells it the data
 *   changed from cached to fresh.
 * - **T053 (BSOD-307)** owns this composition and the service-worker
 *   layer that makes the offline branch reachable at all
 *   (`vite.config.ts`).
 *
 * Determinism
 * -----------
 * The session read is asynchronous (one IndexedDB query) but the
 * surface renders synchronously on first paint: until the read
 * resolves, the banner is simply absent. The `isCached` decision is
 * derived from the browser's online state (synchronous) and from the
 * resolved timestamp, so it never depends on the order in which two
 * asynchronous reads settle.
 *
 * Boundary
 * --------
 * `src/features/refresh/**` is the refresh-flow React UI. This
 * module imports React, the workspace context, the shared
 * `useOnlineStatus` hook, the refresh-session repository, and its two
 * sibling components. It performs no network calls of its own and
 * writes nothing to storage.
 */
import { useEffect, useRef, useState, type ReactElement } from "react";

import { useWorkspace } from "../../app/workspace-context";
import { refreshSessionRepository } from "../../data/db/repositories/refresh-session.repository";
import { useOnlineStatus } from "../../shared/hooks/useOnlineStatus";
import { FreshnessBanner } from "./FreshnessBanner";
import { RefreshControls } from "./RefreshControls";

/**
 * The state the surface tracks about the data it is showing.
 */
interface RefreshStatus {
  /**
   * The completion timestamp of the most recent successful refresh,
   * or `null` when the workspace has never completed one.
   */
  readonly lastRefreshedAt: string | null;
  /**
   * Whether a refresh completed during THIS page session. The flag
   * is what separates "the data came from the local cache at boot"
   * from "the data came from the refresh the user just ran".
   */
  readonly refreshedInSession: boolean;
}

/**
 * The dashboard's refresh-status surface.
 */
export function RefreshStatusPanel(): ReactElement {
  const workspace = useWorkspace();
  const isOnline = useOnlineStatus();
  const workspaceGid = workspace.workspace?.gid ?? null;

  /**
   * The moment this surface mounted. A refresh that finished BEFORE
   * this instant belongs to an earlier session, so the data on screen
   * is the cached copy of that refresh rather than a live one.
   */
  const mountedAtRef = useRef<number>(Date.now());

  const [status, setStatus] = useState<RefreshStatus>({
    lastRefreshedAt: null,
    refreshedInSession: false,
  });

  useEffect(() => {
    if (workspaceGid === null) {
      setStatus({ lastRefreshedAt: null, refreshedInSession: false });
      return;
    }
    let cancelled = false;
    void (async (): Promise<void> => {
      const session =
        await refreshSessionRepository.getLastSuccessful(workspaceGid);
      if (cancelled) {
        return;
      }
      setStatus((current) => ({
        lastRefreshedAt: session?.finishedAt ?? null,
        refreshedInSession: current.refreshedInSession,
      }));
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceGid]);

  /**
   * The cached-or-fresh decision (FR-021).
   *
   * The data is CACHED when any of the following holds:
   *
   * - the browser is offline — nothing on screen can be live;
   * - the last successful refresh finished before this page session
   *   started — the data was loaded from the local cache;
   * - no refresh has completed at all — there is nothing but the
   *   cache to show.
   *
   * It is FRESH only when a refresh completed during this session and
   * the browser is still online.
   */
  const refreshedBeforeThisSession =
    status.lastRefreshedAt !== null &&
    Date.parse(status.lastRefreshedAt) < mountedAtRef.current;
  const isCached =
    !isOnline ||
    status.lastRefreshedAt === null ||
    !status.refreshedInSession ||
    refreshedBeforeThisSession;

  return (
    <section
      className="td-refresh-status"
      data-testid="refresh-status"
      data-online={isOnline ? "true" : "false"}
      aria-label="Refresh status"
    >
      {status.lastRefreshedAt !== null ? (
        <FreshnessBanner
          lastRefreshedAt={status.lastRefreshedAt}
          isCached={isCached}
        />
      ) : null}
      <RefreshControls
        onRefreshCompleted={(completedAt: string): void => {
          setStatus({
            lastRefreshedAt: completedAt,
            refreshedInSession: true,
          });
        }}
      />
    </section>
  );
}
