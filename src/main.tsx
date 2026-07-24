/// <reference types="vite/client" />
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

export function TeamDashShell() {
  return (
    <main className="team-dash-shell" lang="en-AU">
      <h1>Team Dash</h1>
      <p>
        The application shell is bootstrapping. The credential entry screen will
        be implemented in Phase 2.
      </p>
    </main>
  );
}

export function renderApp(rootElement: Element): void {
  createRoot(rootElement).render(
    <StrictMode>
      <TeamDashShell />
    </StrictMode>,
  );
}

/**
 * Boot the MSW browser worker before mounting React in development
 * builds (T030). The worker MUST NOT run in production — see
 * `src/mocks/browser.ts` for the contract rationale. A failed MSW
 * start logs and continues so the app shell still renders during local
 * debugging when the `mockServiceWorker.js` is missing or the browser
 * refuses Service-Worker registration.
 */
async function bootstrapDevMocks(): Promise<void> {
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
  void bootstrapDevMocks().finally(() => {
    renderApp(rootElement);
  });
}
