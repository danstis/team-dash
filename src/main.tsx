/// <reference types="vite/client" />
import { createRoot } from "react-dom/client";

import { App } from "./app/App";

/**
 * T031 — entry point.
 *
 * The application entry point boots the Vite app. Its job is small:
 *
 * 1. Optionally start the MSW dev worker (T030) so the deterministic
 *    fixture dataset is reachable from the dev server.
 * 2. Mount the T031 `<App />` shell (provider tree + router) into the
 *    `#root` element declared in `index.html`.
 *
 * The MSW wiring stays in `main.tsx` (not in `<App />`) because the
 * worker must register before React mounts — a race here would
 * briefly let a real network call escape the dev server. The
 * `bootstrapDevMocks` helper is intentionally separate from
 * `<App />` so it can run on every build without dragging React into
 * the worker-startup path.
 */

export function renderApp(rootElement: Element): void {
  createRoot(rootElement).render(<App />);
}

/**
 * Boot the MSW browser worker before mounting React in development
 * builds (T030). The worker MUST NOT run in production — see
 * `src/mocks/browser.ts` for the contract rationale. A failed MSW
 * start logs and continues so the app shell still renders during local
 * debugging when the `mockServiceWorker.js` is missing or the browser
 * refuses Service-Worker registration.
 */
export async function bootstrapDevMocks(): Promise<void> {
  if (!import.meta.env.DEV) {
    return;
  }
  try {
    const { startDevWorker } = await import("./mocks/browser");
    await startDevWorker();
  } catch (error) {
    console.warn(
      "[team-dash] MSW dev worker failed to start; falling back to live network. " +
        "This is expected in production builds and during unit tests.",
      error,
    );
  }
}

const rootElement = document.getElementById("root");
if (rootElement) {
  await bootstrapDevMocks();
  renderApp(rootElement);
}
