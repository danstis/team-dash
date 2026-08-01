/**
 * BSOD-347 — integration test for the first-run UI composition
 * (`src/features/credentials/FirstRunSetup.tsx` + `src/app/router.tsx`'s
 * `FirstRunRoute`).
 *
 * Spec / contract references
 * --------------------------
 * US1 acceptance scenarios (spec.md §"User Story 1") that flow from
 * this composition:
 *
 *   1. "Given no token has been entered, When the user opens the app,
 *      Then the app shows a first-run credential entry screen and
 *      blocks access to reporting screens until a valid token and
 *      workspace are set."
 *
 *   2. "Given the user enters a syntactically plausible token, When
 *      they choose 'Test token', Then the app calls Asana to validate
 *      it and reports success (with the workspaces the token can
 *      access) or a specific failure reason."
 *
 *   3. "Given a token has been validated, When the user chooses
 *      persistent storage, Then the app explains that the token is
 *      sensitive, states the storage risk and that it remains on this
 *      device/browser profile, and requires an explicit confirmation
 *      step before writing it to IndexedDB."
 *
 *   5. "Given a validated token, When the user views the list of
 *      accessible workspaces, Then they can select exactly one
 *      workspace to use for reporting."
 *
 * And FR-001: "The system MUST require a user-supplied Asana personal
 * access token before any reporting screen is accessible."
 *
 * What this test pins
 * -------------------
 * The Phase 3 components (`TokenEntryForm`, `StorageModeSelector`,
 * `WorkspaceSelector`) exist and pass their unit tests in isolation,
 * but BSOD-347 — the bug under test — was that the live `/` first-run
 * route rendered only a status block rather than composing those
 * components into the gate-closed surface. This integration test is the
 * end-to-end pin: starting from an empty IndexedDB + first-run
 * providers, the user can walk through TokenEntry → StorageMode →
 * WorkspaceSelector on the live `/` route and lift the gate, with the
 * same credentials / workspace state the providers' own state machine
 * would have produced if the test had driven the providers directly.
 *
 * The test deliberately drives the real router (`src/app/router.tsx`'s
 * exported `router`) over the real `CredentialsProvider` /
 * `WorkspaceProvider` tree so the surface the user sees is the same
 * surface the assertion exercises. A unit test that imports
 * `FirstRunSetup` directly would still pass if the router failed to
 * mount it, which is precisely the regression BSOD-347 exposed.
 *
 * Token-safety guard
 * ------------------
 * The fixture PAT is synthetic (a string that is obviously not a real
 * Asana token) and the small-dataset MSW handlers authorise any
 * `Authorization: Bearer …` request. The FR-008 invariant (full token
 * never rendered, logged, or embedded in a URL) is preserved end-to-
 * end because every Phase 3 component already pins it in isolation
 * and the composition does not widen the prop surface.
 *
 * Boundary
 * --------
 * `tests/integration/**` runs against jsdom + `fake-indexeddb` + MSW
 * per `tests/setup.ts`. No browser, no live Asana workspace, no live
 * token (NFR-005).
 */
import { StrictMode } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { router } from "../../../src/app/router";
import { CredentialsProvider } from "../../../src/app/credentials-context";
import { WorkspaceProvider } from "../../../src/app/workspace-context";
import { db } from "../../../src/data/db/schema";
import {
  smallDataset,
  smallDatasetWorkspaceGid,
} from "../../../fixtures/asana/small-dataset/data";

const FIXTURE_TOKEN = "fixture-first-run-flow-token-1234567890";

const PRIMARY_WORKSPACE = smallDataset.workspaces.find(
  (workspace) => workspace.gid === smallDatasetWorkspaceGid,
);
if (PRIMARY_WORKSPACE === undefined) {
  throw new Error(
    "small-dataset fixture must expose a primary workspace for this test",
  );
}

function renderRouterUnderProviders(): ReturnType<typeof render> {
  const { RouterProvider } = require("react-router");
  return render(
    <StrictMode>
      <CredentialsProvider>
        <WorkspaceProvider>
          <RouterProvider router={router} />
        </WorkspaceProvider>
      </CredentialsProvider>
    </StrictMode>,
  );
}

function enterTokenAndTest(): void {
  const tokenInput = screen.getByLabelText(/^token$/i) as HTMLInputElement;
  fireEvent.change(tokenInput, { target: { value: FIXTURE_TOKEN } });
  fireEvent.click(screen.getByRole("button", { name: /test token/i }));
}

describe("BSOD-347 first-run UI composition (`/` route)", () => {
  beforeEach(async () => {
    await db.credentials.clear();
    await db.workspaces.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the TokenEntryForm on the live `/` route so the user can enter a token", async () => {
    renderRouterUnderProviders();

    // Wait for both providers' IndexedDB lookups to resolve before
    // asserting the rendered surface (StrictMode double-invokes
    // effects, so the gate decision can only be trusted once both
    // providers report `'first_run'`).
    await waitFor(() => {
      expect(
        document.querySelector('[data-view-state="first_run"]'),
      ).not.toBeNull();
    });

    // The first-run UI composition MUST include the existing T041
    // TokenEntryForm — the BSOD-347 regression was that the gate-
    // closed surface only rendered a status block. The form's
    // `data-testid` is the stable anchor.
    expect(screen.getByTestId("token-entry-form")).toBeInTheDocument();
    expect(screen.getByLabelText(/^token$/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /test token/i }),
    ).toBeInTheDocument();
  });

  it("advances through token → storage mode → workspace and lifts the gate on the live `/` route", async () => {
    renderRouterUnderProviders();

    await waitFor(() => {
      expect(
        document.querySelector('[data-view-state="first_run"]'),
      ).not.toBeNull();
    });

    // Phase 1 — token entry + test. After a successful `testToken`
    // the TokenEntryForm internally runs `listWorkspaces`, fires its
    // `onValidated` callback, and the FirstRunSetup composition must
    // advance to the StorageModeSelector phase.
    enterTokenAndTest();

    await waitFor(() => {
      expect(screen.getByTestId("storage-mode-selector")).toBeInTheDocument();
    });
    // The TokenEntryForm is no longer the active phase once the
    // token has been validated.
    expect(screen.queryByTestId("token-entry-form")).not.toBeInTheDocument();

    // Phase 2 — choose session-only storage. The selector calls
    // `useCredentials().setSessionToken`, which transitions the
    // credentials context to `'ready'`. The composition must then
    // advance to the WorkspaceSelector phase.
    fireEvent.click(screen.getByRole("radio", { name: /session[- ]only/i }));

    await waitFor(() => {
      expect(screen.getByTestId("workspace-selector")).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("storage-mode-selector"),
    ).not.toBeInTheDocument();

    // Phase 3 — choose a workspace. The selector calls
    // `useWorkspace().selectWorkspace`, which transitions the
    // workspace context to `'ready'`. Both providers are now ready
    // so the gate lifts and the placeholder reporting surface
    // (T031) becomes visible.
    fireEvent.change(screen.getByRole("combobox", { name: /workspace/i }), {
      target: { value: PRIMARY_WORKSPACE.gid },
    });
    fireEvent.click(screen.getByRole("button", { name: /select workspace/i }));

    await waitFor(() => {
      // First-run primitive is gone; the placeholder reporting
      // surface (T031's `<h1>Team Dash</h1>`) is visible. The
      // `data-view-state="first_run"` sentinel is the canonical
      // gate anchor per `FirstRunState`'s ViewState contract.
      expect(
        document.querySelector('[data-view-state="first_run"]'),
      ).toBeNull();
      expect(
        screen.getByRole("heading", { level: 1, name: /team dash/i }),
      ).toBeInTheDocument();
    });

    // WorkspaceSelector is also gone — once the gate lifts, the
    // first-run composition unmounts and the placeholder takes its
    // place.
    expect(screen.queryByTestId("workspace-selector")).not.toBeInTheDocument();

    // The credentials provider is now in the documented session
    // state (FR-002 default — session-only unless the user opts
    // into persistent) and the workspace is persisted.
    const persistedWorkspaces = await db.workspaces.toArray();
    expect(persistedWorkspaces).toHaveLength(1);
    expect(persistedWorkspaces[0]?.gid).toBe(PRIMARY_WORKSPACE.gid);
  });

  it("closes the gate again after the user clears the credential via the FR-007 single-action wipe and the form re-renders", async () => {
    renderRouterUnderProviders();

    await waitFor(() => {
      expect(
        document.querySelector('[data-view-state="first_run"]'),
      ).not.toBeNull();
    });

    // Walk to the gate-open state.
    enterTokenAndTest();
    await waitFor(() => {
      expect(screen.getByTestId("storage-mode-selector")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("radio", { name: /session[- ]only/i }));
    await waitFor(() => {
      expect(screen.getByTestId("workspace-selector")).toBeInTheDocument();
    });
    fireEvent.change(screen.getByRole("combobox", { name: /workspace/i }), {
      target: { value: PRIMARY_WORKSPACE.gid },
    });
    fireEvent.click(screen.getByRole("button", { name: /select workspace/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { level: 1, name: /team dash/i }),
      ).toBeInTheDocument();
    });

    // FR-007 single-action wipe: simulate the Settings panel's
    // Clear-All flow by clearing both Dexie stores and triggering a
    // re-render via remount. The first-run composition MUST re-appear
    // so the user can re-enter their token (the spec clarification
    // for FR-002b / FR-007).
    await db.credentials.clear();
    await db.workspaces.clear();
    cleanup();

    renderRouterUnderProviders();

    await waitFor(() => {
      expect(
        document.querySelector('[data-view-state="first_run"]'),
      ).not.toBeNull();
    });
    expect(screen.getByTestId("token-entry-form")).toBeInTheDocument();
  });
});
