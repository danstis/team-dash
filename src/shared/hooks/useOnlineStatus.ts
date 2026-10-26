/**
 * BSOD-307 (T053) — the shared online/offline state hook.
 *
 * The browser is the only authority on whether the app currently has a
 * network: `navigator.onLine` reports the connection state and the
 * `online` / `offline` events announce every change to it. The T050
 * `OfflineRefreshState` component reads that state directly, and the
 * dashboard's refresh-status surface needs the same answer to decide
 * whether the data it is showing is cached (FR-021 / FR-087) — so the
 * read lives here once and both call sites share it.
 *
 * Why the state is read from the platform rather than from a prop
 * -----------------------------------------------------------------
 * The offline branch is a property of the *browser*, not of a
 * component tree: a reload, a reconnect, and a tab refocus all change
 * it without any component asking. A synthetic prop would have to be
 * threaded through every surface that cares, and the surfaces would
 * disagree the moment one of them forgot to pass it down.
 *
 * Determinism
 * -----------
 * The initial value is read from `navigator.onLine` at mount time and
 * every later change arrives through the `online` / `offline` window
 * events. A test can therefore drive the hook deterministically by
 * overriding `navigator.onLine` before the component mounts and
 * dispatching the matching event afterwards — no live network is
 * involved.
 *
 * Boundary
 * --------
 * The hook reads browser state and nothing else. It performs no
 * network calls and touches no storage, so it stays usable from every
 * layer that needs to know whether the app is online.
 */
import { useEffect, useState } from "react";

/**
 * Read the browser's current connection state.
 *
 * `navigator.onLine` is `false` only when the browser *knows* it is
 * offline; a missing `navigator` (a non-browser environment) is
 * treated as online so the hook never disables the UI by accident.
 */
function readNavigatorOnline(): boolean {
  if (typeof navigator === "undefined") {
    return true;
  }
  return navigator.onLine !== false;
}

/**
 * Track the browser's online / offline state.
 *
 * @returns `true` while the browser reports a network connection,
 * `false` while it reports that it is offline.
 */
export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    readNavigatorOnline(),
  );

  useEffect(() => {
    const handleOnline = (): void => {
      setIsOnline(true);
    };
    const handleOffline = (): void => {
      setIsOnline(false);
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return isOnline;
}
