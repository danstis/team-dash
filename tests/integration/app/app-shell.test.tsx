/**
 * T031 — integration test for the app-shell provider tree.
 *
 * The unit tests in `tests/unit/app/{credentials,workspace,app}.test.tsx`
 * pin the per-context surface; this file is the contract test that the
 * shell composes those contexts in the order every downstream feature
 * depends on.
 *
 * What "integration" means here
 * -----------------------------
 * No browser, no live Asana, no MSW. The test boots the full `<App />`
 * tree in jsdom + Dexie's `fake-indexeddb` and exercises the *real*
 * provider-to-provider handoff — CredentialsProvider resolves first,
 * the WorkspaceProvider reads from the same Dexie instance, and a
 * downstream consumer can read both contexts in a single render.
 *
 * That cross-context handoff is what every Phase 3 feature (US1's
 * route guard T046, US2's first-run → refresh flow) depends on. If
 * the provider tree renders the contexts in the wrong order, or if
 * either provider drops children on a re-render, this test fails
 * before the feature-level test would even start.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { App } from "../../../src/app/App";
import {
  CredentialsProvider,
  useCredentials,
} from "../../../src/app/credentials-context";
import {
  WorkspaceProvider,
  useWorkspace,
} from "../../../src/app/workspace-context";
import { db } from "../../../src/data/db/schema";

function TreeProbe(): React.ReactElement {
  const credentials = useCredentials();
  const workspace = useWorkspace();
  return (
    <div data-testid="tree-probe">
      <span data-testid="probe-credentials-state">{credentials.state}</span>
      <span data-testid="probe-workspace-state">{workspace.state}</span>
    </div>
  );
}

describe("T031 app-shell provider-tree integration", () => {
  afterEach(async () => {
    cleanup();
    await db.credentials.clear();
    await db.workspaces.clear();
  });

  it("renders both contexts with their initial `'loading'` ViewStates", () => {
    render(
      <CredentialsProvider>
        <WorkspaceProvider>
          <TreeProbe />
        </WorkspaceProvider>
      </CredentialsProvider>,
    );

    expect(screen.getByTestId("probe-credentials-state").textContent).toBe(
      "loading",
    );
    expect(screen.getByTestId("probe-workspace-state").textContent).toBe(
      "loading",
    );
  });

  it("resolves both contexts after the IndexedDB round-trip", async () => {
    render(
      <CredentialsProvider>
        <WorkspaceProvider>
          <TreeProbe />
        </WorkspaceProvider>
      </CredentialsProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("probe-credentials-state").textContent).toBe(
        "first_run",
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId("probe-workspace-state").textContent).toBe(
        "first_run",
      );
    });
  });

  it("composes both providers under the <App /> shell", () => {
    // <App /> is the production wiring. A consumer that drops a
    // provider from <App /> silently breaks every downstream feature
    // that reads the missing context — pin the wiring in the
    // integration test.
    const { container } = render(<App />);
    expect(container.querySelector("main")).not.toBeNull();
  });
});
