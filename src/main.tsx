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

const rootElement = document.getElementById("root");
if (rootElement) {
  renderApp(rootElement);
}
