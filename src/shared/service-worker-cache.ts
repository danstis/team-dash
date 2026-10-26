/**
 * BSOD-307 (T053) — the wire contract between the generated service
 * worker and the app's Asana client.
 *
 * The service worker keeps the last complete Asana responses in its
 * runtime cache so the app has a network-independent copy of the data
 * it last retrieved (the network-layer half of FR-087's "cached
 * dashboard"). A response the worker serves from that cache is NOT
 * live data, and the app has to be able to tell the two apart: a
 * refresh may only ever commit live data (FR-022 / Constitution
 * Principle V — "a failed, cancelled, or incomplete refresh MUST NOT
 * replace a previously complete cache").
 *
 * The worker marks every cached response it serves with the header
 * below; `src/data/asana/client.ts` refuses such a response unless
 * the caller explicitly opts in. The constant lives here — a leaf
 * module with no imports — so the build configuration
 * (`vite.config.ts`, which produces the worker) and the runtime client
 * cannot drift apart.
 *
 * The header is a same-origin response header the worker adds to a
 * response it constructs itself; it never leaves the browser and never
 * carries the personal access token (FR-008 / FR-010).
 */

/**
 * The response header the generated service worker adds to a response
 * it serves from its runtime cache.
 */
export const SERVICE_WORKER_CACHE_HEADER = "X-Team-Dash-Served-From";

/**
 * The value the service worker puts in
 * {@link SERVICE_WORKER_CACHE_HEADER} when it answers a request from
 * its runtime cache.
 */
export const SERVICE_WORKER_CACHE_HEADER_VALUE = "service-worker-cache";

/**
 * The name of the service worker's runtime cache for the Asana read
 * endpoints.
 *
 * The name is shared so the "clear all" credential action can delete
 * the cache the worker keeps: FR-007 promises the user that one
 * explicit action removes every trace of the Asana data this browser
 * holds, and a copy of the last complete responses in the worker's
 * CacheStorage would otherwise outlive that promise.
 */
export const ASANA_API_CACHE_NAME = "team-dash-asana-api";

/**
 * Delete the service worker's Asana API cache.
 *
 * Called by the credentials context's "clear all" action. The call is
 * best-effort: an environment without the Cache Storage API (the
 * jsdom unit tests) is not an error, and a failed delete must not
 * stop the credential wipe that already happened.
 */
export async function clearServiceWorkerApiCache(): Promise<void> {
  if (typeof caches === "undefined") {
    return;
  }
  try {
    await caches.delete(ASANA_API_CACHE_NAME);
  } catch {
    // Best-effort: the credential wipe is the contract that matters
    // (FR-007); a browser that refuses the delete must not turn the
    // clear-all action into a failure.
  }
}
