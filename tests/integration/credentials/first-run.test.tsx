/**
 * T035 [P] [US1] — Integration test for the first-run screen-blocking
 * contract.
 *
 * Spec acceptance scenario (spec.md §"User Story 1"):
 *
 *   "Given no token has been entered, When the user opens the app, Then the
 *    app shows a first-run credential entry screen and blocks access to
 *    reporting screens until a valid token and workspace are set."
 *
 * And the broader first-run gate contract that flows from it (FR-001 —
 * "The system MUST require a user-supplied Asana personal access token
 * before any reporting screen is accessible"):
 *
 *   - With neither credential nor workspace set: the first-run screen is
 *     the rendered surface; reporting chrome is not visible.
 *   - With only the credential set (workspace missing): the first-run
 *     screen is still the rendered surface.
 *   - With only the workspace set (credential missing): the first-run
 *     screen is still the rendered surface.
 *   - With BOTH credential and workspace set: the first-run screen is
 *     not rendered; reporting content takes its place.
 *   - Returning to first-run via clearAll (`FR-007`) brings the first-run
 *     screen back.
 *
 * ## Test-first (Constitution Principle III)
 *
 * This test is RED against the current implementation on the day it
 * lands. The `[P]` parallel-safe sibling tasks in Phase 3 (T034 contract
 * test BSOD-162; T039 `testToken`/`listWorkspaces` BSOD-167; T041
 * `TokenEntryForm` BSOD-169; T043 `WorkspaceSelector` BSOD-171; …
 * **T046 route guard wiring BSOD-174**) all sit in US1, the same user
 * story, and together they turn the assertions below green:
 *
 *   - The screen-level assertions under
 *     "First-run screen blocks reporting screens" become green once
 *     T046 wires the route guard in `src/app/router.tsx` and the
 *     `FirstRunState` primitive (T032, `src/shared/states/FirstRunState.tsx`)
 *     becomes reachable from the router when neither credential nor
 *     workspace is ready.
 *
 *   - The provider state-machine assertions under
 *     "First-run provider state machine" are green today against the
 *     already-merged T031 provider implementation; they pin the
 *     state-machine precondition the screen-level tests rely on so a
 *     future contributor who breaks the gate's data side fails this
 *     file before the route guard does.
 *
 * Until the parallel implementation tasks land, the screen-level
 * assertions fail by design. The PR that lands T035 ships the test
 * file as the Red-phase contract per Spec Kit's TDD discipline; the
 * companion implementation PR(s) flip these assertions to green without
 * changing this file's expectations.
 *
 * ## What this test deliberately does NOT depend on
 *
 *   - User-facing forms (T041 TokenEntryForm, T042 StorageModeSelector,
 *     T043 WorkspaceSelector, T045 SettingsCredentialsPanel): the test
 *     drives the underlying providers via their public action surface
 *     (`setSessionToken`, `selectWorkspace`, `clearAll`,
 *     `clearSelection`). The route-guard wiring that US1's forms
 *     exercise is precisely what this test pins the contract for.
 *
 *   - Live Asana / MSW fixtures: no Asana HTTP traffic is involved;
 *     the gate operates entirely on local provider state (per FR-002,
 *     FR-002a, FR-002b the credential workflow is fully local until
 *     the user actively calls `testToken`).
 *
 *   - Reporting chrome (US2's dashboard): for the "gate has lifted"
 *     assertion the test probes for the **absence** of the first-run
 *     primitive and the **presence** of any reporting surface; the
 *     T031 placeholder route (`<main class="team-dash-shell">` with
 *     `<h1>Team Dash</h1>`) acts as the placeholder reporting surface
 *     until US2's dashboard chrome lands. The test stays valid against
 *     that eventual swap because it asserts the existence of "any
 *     reporting surface" via the absence of the gate, not the
 *     contents of the surface.
 *
 * ## Boundary
 *
 * `tests/integration/**` runs against the jsdom + Dexie `fake-indexeddb`
 * + MSW environment set up by `tests/setup.ts`. No browser, no live
 * Asana, no MSW — this file is local-only by design.
 */
import { type ReactElement, StrictMode, useEffect } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CredentialsProvider,
  useCredentials,
  type CredentialsContextValue,
} from "../../../src/app/credentials-context";
import { router } from "../../../src/app/router";
import {
  WorkspaceProvider,
  useWorkspace,
  type SelectedWorkspace,
  type WorkspaceContextValue,
} from "../../../src/app/workspace-context";
import { db } from "../../../src/data/db/schema";

/* -------------------------------------------------------------------------- */
/* Test helpers                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The shape the test-side "handle capture" pattern publishes so an
 * assertion can drive the providers without imperatively exposing them
 * via a ref handle that React would warn about during render.
 */
interface CapturedHandles {
  credentials: CredentialsContextValue | null;
  workspace: WorkspaceContextValue | null;
}

/**
 * The test-scope "handle container" — a plain mutable object that the
 * probe writes into from a `useEffect` and the test reads from after
 * `waitFor` settles the post-commit publish. Deliberately distinct from
 * React's `RefObject<T>`/`MutableRefObject<T>` because neither maps to
 * the "test owns the container, component writes to it from
 * `useEffect`" pattern; this is the same shape the existing tests in
 * this codebase (e.g. `app-shell.test.tsx`'s `TreeProbe`) use via
 * `useState` indirection, lifted out to a plain object so the test
 * body can capture-then-drive across calls.
 */
type HandlesRef = { current: CapturedHandles | null };

/**
 * The T035 probe. Reads both providers' state (rendered to the DOM so the
 * existing `app-shell.test.tsx` assertion style applies) and writes the
 * live action handles into the consumer-supplied `handlesRef` via a
 * `useEffect` so the test can drive transitions from outside the tree.
 *
 * The `useEffect` publish is intentional: capturing into a ref during
 * render would warn under StrictMode's double-invoke in dev; the post-
 * render effect write happens after commit and is the canonical place
 * to publish derived data out of a render tree to a test harness.
 *
 * The probe's returned DOM is deliberately minimal — its job is to
 * publish state and handle refs, not to add visual surface area that
 * would couple this file to the eventual reporting chrome.
 */
function FirstRunGateProbe({
  handlesRef,
}: {
  handlesRef: HandlesRef;
}): ReactElement {
  const credentials = useCredentials();
  const workspace = useWorkspace();
  useEffect(() => {
    handlesRef.current = {
      credentials,
      workspace,
    };
  });
  return (
    <div data-testid="first-run-gate-probe">
      <span data-testid="probe-credentials-state">{credentials.state}</span>
      <span data-testid="probe-workspace-state">{workspace.state}</span>
    </div>
  );
}

/**
 * The T035 fixture workspace used to drive the providers through the
 * gating transitions. `selectedAt` is the `ISODateTime`-shaped string
 * the Dexie row carries; the cast acknowledges the structural-typing
 * relaxation the existing `WorkspaceProvider` documents in
 * `workspace-context.tsx`.
 */
const SAMPLE_WORKSPACE: SelectedWorkspace = {
  gid: "11111111-test-workspace",
  name: "Acme Team Workspace",
  selectedAt:
    "2026-07-25T10:00:00.000Z" as unknown as SelectedWorkspace["selectedAt"],
};

/**
 * The DOM-surface sentinel the `FirstRunState` primitive carries. The
 * primitive emits `data-view-state="first_run"` per the ViewState
 * primitive contract (`src/shared/states/types.ts`) so an integration
 * test can identify the gate without coupling to copy. The contract
 * attribute is the T035 anchor — coupling on `data-testid` would force
 * a future contributor to plumb a test-id through every consumer
 * rather than rely on the primitive's documented shape.
 */
const FIRST_RUN_DATA_ATTR = "first_run";

/**
 * The DOM-surface sentinel for the T031 reporting-screen placeholder.
 * The placeholder is the test's "any reporting surface" proxy until US2
 * lands the dashboard chrome; once it does, the test stays valid because
 * it asserts the *absence* of the gate, not the contents of the surface.
 */
function findReportingSurfaceHeading(): HTMLElement | null {
  return screen.queryByRole("heading", { level: 1, name: /team dash/i });
}

/* -------------------------------------------------------------------------- */
/* First-run provider state machine — GREEN today (T031 precondition)         */
/* -------------------------------------------------------------------------- */

describe("T035 [US1] first-run provider state-machine contract", () => {
  beforeEach(async () => {
    await db.credentials.clear();
    await db.workspaces.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("starts in 'first_run' for both providers with no stored data", async () => {
    const handlesRef: HandlesRef = { current: null };
    render(
      <StrictMode>
        <CredentialsProvider>
          <WorkspaceProvider>
            <FirstRunGateProbe handlesRef={handlesRef} />
          </WorkspaceProvider>
        </CredentialsProvider>
      </StrictMode>,
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
    expect(handlesRef.current).not.toBeNull();
    expect(handlesRef.current?.credentials?.state).toBe("first_run");
    expect(handlesRef.current?.workspace?.state).toBe("first_run");
  });

  it("transitions credentials to 'ready' but leaves workspace in 'first_run' when only a session token is set", async () => {
    const handlesRef: HandlesRef = { current: null };
    render(
      <StrictMode>
        <CredentialsProvider>
          <WorkspaceProvider>
            <FirstRunGateProbe handlesRef={handlesRef} />
          </WorkspaceProvider>
        </CredentialsProvider>
      </StrictMode>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("probe-credentials-state").textContent).toBe(
        "first_run",
      );
    });
    await waitFor(() => {
      expect(handlesRef.current?.credentials).not.toBeNull();
    });

    await handlesRef.current?.credentials?.setSessionToken(
      "test-token-value-abcd",
      "…abcd",
    );

    await waitFor(() => {
      expect(screen.getByTestId("probe-credentials-state").textContent).toBe(
        "ready",
      );
    });
    expect(screen.getByTestId("probe-workspace-state").textContent).toBe(
      "first_run",
    );
    expect(handlesRef.current?.credentials?.mode).toBe("session");
    expect(handlesRef.current?.credentials?.maskedIdentifier).toBe("…abcd");
  });

  it("keeps the gate closed when only the workspace is selected (credential missing)", async () => {
    const handlesRef: HandlesRef = { current: null };
    render(
      <StrictMode>
        <CredentialsProvider>
          <WorkspaceProvider>
            <FirstRunGateProbe handlesRef={handlesRef} />
          </WorkspaceProvider>
        </CredentialsProvider>
      </StrictMode>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("probe-credentials-state").textContent).toBe(
        "first_run",
      );
    });
    await waitFor(() => {
      expect(handlesRef.current?.workspace).not.toBeNull();
    });

    await handlesRef.current?.workspace?.selectWorkspace(SAMPLE_WORKSPACE);

    await waitFor(() => {
      expect(screen.getByTestId("probe-workspace-state").textContent).toBe(
        "ready",
      );
    });
    // Credentials remain first_run because no token was provided; the gate
    // is closed per FR-001 ("require a user-supplied … token before any
    // reporting screen is accessible").
    expect(screen.getByTestId("probe-credentials-state").textContent).toBe(
      "first_run",
    );
    expect(handlesRef.current?.workspace?.workspace).toEqual(SAMPLE_WORKSPACE);
  });

  it("lifts the gate only when BOTH credential and workspace are set", async () => {
    const handlesRef: HandlesRef = { current: null };
    render(
      <StrictMode>
        <CredentialsProvider>
          <WorkspaceProvider>
            <FirstRunGateProbe handlesRef={handlesRef} />
          </WorkspaceProvider>
        </CredentialsProvider>
      </StrictMode>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("probe-credentials-state").textContent).toBe(
        "first_run",
      );
    });
    await waitFor(() => {
      expect(handlesRef.current?.credentials).not.toBeNull();
    });

    await handlesRef.current?.credentials?.setSessionToken(
      "test-token-value-efgh",
      "…efgh",
    );
    await waitFor(() => {
      expect(screen.getByTestId("probe-credentials-state").textContent).toBe(
        "ready",
      );
    });
    expect(screen.getByTestId("probe-workspace-state").textContent).toBe(
      "first_run",
    );

    await handlesRef.current?.workspace?.selectWorkspace(SAMPLE_WORKSPACE);
    await waitFor(() => {
      expect(screen.getByTestId("probe-workspace-state").textContent).toBe(
        "ready",
      );
    });
    expect(screen.getByTestId("probe-credentials-state").textContent).toBe(
      "ready",
    );
  });

  it("returns both providers to 'first_run' after the FR-007 single-action clear", async () => {
    const handlesRef: HandlesRef = { current: null };
    render(
      <StrictMode>
        <CredentialsProvider>
          <WorkspaceProvider>
            <FirstRunGateProbe handlesRef={handlesRef} />
          </WorkspaceProvider>
        </CredentialsProvider>
      </StrictMode>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("probe-credentials-state").textContent).toBe(
        "first_run",
      );
    });
    await waitFor(() => {
      expect(handlesRef.current?.credentials).not.toBeNull();
    });

    await handlesRef.current?.credentials?.setSessionToken(
      "test-token-value-ijkl",
      "…ijkl",
    );
    await handlesRef.current?.workspace?.selectWorkspace(SAMPLE_WORKSPACE);
    await waitFor(() => {
      expect(screen.getByTestId("probe-workspace-state").textContent).toBe(
        "ready",
      );
    });

    // FR-007 single-action wipe: the production wiring is the Settings
    // panel's clear-all (T045) which composes both surfaces. Here we
    // assert the per-provider clear surfaces preserve the gate invariant
    // (both contexts back to first_run) — the contract the future
    // Settings panel depends on.
    await handlesRef.current?.credentials?.clearAll();
    await handlesRef.current?.workspace?.clearSelection();

    await waitFor(() => {
      expect(screen.getByTestId("probe-credentials-state").textContent).toBe(
        "first_run",
      );
    });
    expect(screen.getByTestId("probe-workspace-state").textContent).toBe(
      "first_run",
    );
  });

  it("persists the 'ready' gate state across remount when both contexts are stored", async () => {
    // Sanity check that the IndexedDB-backed persistence underpinning the
    // gate survives a remount — covers FR-002 (persistent token handling)
    // and the equivalent workspace persistence, both of which are
    // preconditions for the gate staying closed when a user clears all data
    // via Settings (FR-007) and for the gate staying open across an app
    // reload when both are intentionally persisted.
    await db.credentials.clear();
    await db.workspaces.clear();

    {
      const handlesRef: HandlesRef = { current: null };
      const { unmount } = render(
        <StrictMode>
          <CredentialsProvider>
            <WorkspaceProvider>
              <FirstRunGateProbe handlesRef={handlesRef} />
            </WorkspaceProvider>
          </CredentialsProvider>
        </StrictMode>,
      );
      await waitFor(() => {
        expect(handlesRef.current?.credentials).not.toBeNull();
      });
      // Persist a workspace selection in IndexedDB; the Credentials side
      // remains session-only by default (FR-002 — no persistent record
      // because the user declined the storage risk disclosure per FR-003).
      await handlesRef.current?.workspace?.selectWorkspace(SAMPLE_WORKSPACE);
      await waitFor(() => {
        expect(screen.getByTestId("probe-workspace-state").textContent).toBe(
          "ready",
        );
      });
      unmount();
    }

    {
      const handlesRef: HandlesRef = { current: null };
      render(
        <StrictMode>
          <CredentialsProvider>
            <WorkspaceProvider>
              <FirstRunGateProbe handlesRef={handlesRef} />
            </WorkspaceProvider>
          </CredentialsProvider>
        </StrictMode>,
      );
      // The remount re-reads IndexedDB; the workspace selection persists
      // (T031's `workspace-context.tsx` reads back the most-recent row),
      // so the workspace side is ready across the remount.
      await waitFor(() => {
        expect(screen.getByTestId("probe-workspace-state").textContent).toBe(
          "ready",
        );
      });
      // Credentials remain first_run (session-only was dropped on remount,
      // per the spec's first-run-with-no-persistent-record rule); the gate
      // therefore stays closed from the user's perspective.
      expect(screen.getByTestId("probe-credentials-state").textContent).toBe(
        "first_run",
      );
      expect(handlesRef.current?.workspace?.workspace).toEqual(
        SAMPLE_WORKSPACE,
      );
    }
  });
});

/* -------------------------------------------------------------------------- */
/* First-run screen blocks reporting screens — TEST-FIRST (Red until T046)    */
/* -------------------------------------------------------------------------- */

describe("T035 [US1] first-run screen blocks reporting screens (test-first)", () => {
  beforeEach(async () => {
    await db.credentials.clear();
    await db.workspaces.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the first-run primitive and hides the reporting surface when no credential and no workspace are set", async () => {
    const handlesRef: HandlesRef = { current: null };
    render(
      <StrictMode>
        <CredentialsProvider>
          <WorkspaceProvider>
            <RouterProvider router={router} />
            <FirstRunGateProbe handlesRef={handlesRef} />
          </WorkspaceProvider>
        </CredentialsProvider>
      </StrictMode>,
    );

    // Wait for the providers' initial IndexedDB lookup to resolve before
    // asserting the rendered surface — StrictMode double-invokes effects,
    // so the gate decision can only be trusted once both providers report
    // their settled state.
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

    // The first-run primitive carries data-view-state="first_run" on its
    // root per the ViewState primitive contract (src/shared/states/types.ts).
    // Test-first: this assertion is RED today because T046's route guard
    // does not yet wire the primitive into the router. It becomes GREEN
    // when the guard swaps the reporting surface for FirstRunState when
    // neither context is ready.
    expect(
      document.querySelector(`[data-view-state="${FIRST_RUN_DATA_ATTR}"]`),
    ).not.toBeNull();

    // The T031 reporting-surface placeholder (or US2's eventual dashboard
    // chrome) MUST NOT be visible while the gate is closed. The selector
    // finds the T031 placeholder by its accessible name; once US2 lands,
    // the test stays valid because the assertion is the negation of "first
    // run primitive is visible" — i.e. it asserts that the gate is closed,
    // not that any specific reporting surface is absent.
    expect(findReportingSurfaceHeading()).toBeNull();
  });

  it("still hides the reporting surface when only the credential is set (workspace missing)", async () => {
    const handlesRef: HandlesRef = { current: null };
    render(
      <StrictMode>
        <CredentialsProvider>
          <WorkspaceProvider>
            <RouterProvider router={router} />
            <FirstRunGateProbe handlesRef={handlesRef} />
          </WorkspaceProvider>
        </CredentialsProvider>
      </StrictMode>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("probe-credentials-state").textContent).toBe(
        "first_run",
      );
    });
    await waitFor(() => {
      expect(handlesRef.current?.credentials).not.toBeNull();
    });

    await handlesRef.current?.credentials?.setSessionToken(
      "test-token-value-mnop",
      "…mnop",
    );

    await waitFor(() => {
      expect(screen.getByTestId("probe-credentials-state").textContent).toBe(
        "ready",
      );
    });
    expect(screen.getByTestId("probe-workspace-state").textContent).toBe(
      "first_run",
    );

    // Credentials only — workspace missing — the gate stays closed.
    expect(
      document.querySelector(`[data-view-state="${FIRST_RUN_DATA_ATTR}"]`),
    ).not.toBeNull();
    expect(findReportingSurfaceHeading()).toBeNull();
  });

  it("still hides the reporting surface when only the workspace is set (credential missing)", async () => {
    const handlesRef: HandlesRef = { current: null };
    render(
      <StrictMode>
        <CredentialsProvider>
          <WorkspaceProvider>
            <RouterProvider router={router} />
            <FirstRunGateProbe handlesRef={handlesRef} />
          </WorkspaceProvider>
        </CredentialsProvider>
      </StrictMode>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("probe-credentials-state").textContent).toBe(
        "first_run",
      );
    });
    await waitFor(() => {
      expect(handlesRef.current?.workspace).not.toBeNull();
    });

    await handlesRef.current?.workspace?.selectWorkspace(SAMPLE_WORKSPACE);

    await waitFor(() => {
      expect(screen.getByTestId("probe-workspace-state").textContent).toBe(
        "ready",
      );
    });
    expect(screen.getByTestId("probe-credentials-state").textContent).toBe(
      "first_run",
    );

    // Workspace only — credential missing — the gate stays closed per
    // FR-001 ("require a user-supplied … token before any reporting
    // screen is accessible").
    expect(
      document.querySelector(`[data-view-state="${FIRST_RUN_DATA_ATTR}"]`),
    ).not.toBeNull();
    expect(findReportingSurfaceHeading()).toBeNull();
  });

  it("renders reporting content and hides the first-run primitive once BOTH credential and workspace are set", async () => {
    const handlesRef: HandlesRef = { current: null };
    render(
      <StrictMode>
        <CredentialsProvider>
          <WorkspaceProvider>
            <RouterProvider router={router} />
            <FirstRunGateProbe handlesRef={handlesRef} />
          </WorkspaceProvider>
        </CredentialsProvider>
      </StrictMode>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("probe-credentials-state").textContent).toBe(
        "first_run",
      );
    });
    await waitFor(() => {
      expect(handlesRef.current?.credentials).not.toBeNull();
    });

    await handlesRef.current?.credentials?.setSessionToken(
      "test-token-value-qrst",
      "…qrst",
    );
    await handlesRef.current?.workspace?.selectWorkspace(SAMPLE_WORKSPACE);

    await waitFor(() => {
      expect(screen.getByTestId("probe-credentials-state").textContent).toBe(
        "ready",
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId("probe-workspace-state").textContent).toBe(
        "ready",
      );
    });

    // Gate is open: first-run primitive is not rendered, reporting content
    // is. The T031 placeholder serves as the test's reporting-surface proxy
    // until US2's dashboard chrome lands. Test-first: the gate open state
    // is RED today (T046's route guard does not yet exist); it becomes
    // GREEN when the guard lifts and the router renders the reporting
    // surface when both contexts are ready.
    expect(
      document.querySelector(`[data-view-state="${FIRST_RUN_DATA_ATTR}"]`),
    ).toBeNull();
    expect(findReportingSurfaceHeading()).not.toBeNull();
  });

  it("closes the gate again after the FR-007 single-action clear", async () => {
    const handlesRef: HandlesRef = { current: null };
    render(
      <StrictMode>
        <CredentialsProvider>
          <WorkspaceProvider>
            <RouterProvider router={router} />
            <FirstRunGateProbe handlesRef={handlesRef} />
          </WorkspaceProvider>
        </CredentialsProvider>
      </StrictMode>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("probe-credentials-state").textContent).toBe(
        "first_run",
      );
    });
    await waitFor(() => {
      expect(handlesRef.current?.credentials).not.toBeNull();
    });

    await handlesRef.current?.credentials?.setSessionToken(
      "test-token-value-uvwx",
      "…uvwx",
    );
    await handlesRef.current?.workspace?.selectWorkspace(SAMPLE_WORKSPACE);
    await waitFor(() => {
      expect(screen.getByTestId("probe-workspace-state").textContent).toBe(
        "ready",
      );
    });

    // FR-007 single-action wipe returning both contexts to first_run.
    await handlesRef.current?.credentials?.clearAll();
    await handlesRef.current?.workspace?.clearSelection();

    await waitFor(() => {
      expect(screen.getByTestId("probe-credentials-state").textContent).toBe(
        "first_run",
      );
    });
    expect(screen.getByTestId("probe-workspace-state").textContent).toBe(
      "first_run",
    );

    expect(
      document.querySelector(`[data-view-state="${FIRST_RUN_DATA_ATTR}"]`),
    ).not.toBeNull();
    expect(findReportingSurfaceHeading()).toBeNull();
  });
});

/**
 * Note on test id resolution: the `FirstRunState` primitive carries
 * `data-testid` only when its caller supplies one via
 * `ViewStatePrimitiveProps.data-testid`; the default `className` is
 * `"td-first-run-state"` (see `src/shared/states/FirstRunState.tsx`).
 * The T035 test intentionally resolves the gate by the
 * `data-view-state` attribute — the stable contract the primitive
 * publishes across every consumer — rather than the test-id or class
 * name. A future contributor who couples the gate test to a test-id
 * would force the constant through every consumer; the contract
 * attribute is the canonical anchor.
 */
