/**
 * BSOD-347 — `FirstRunSetup`, the first-run UI composition for the
 * live `/` route.
 *
 * Spec / contract references
 * --------------------------
 * US1 acceptance scenarios (spec.md §"User Story 1"):
 *
 *   1. "Given no token has been entered, When the user opens the app,
 *      Then the app shows a first-run credential entry screen and
 *      blocks access to reporting screens until a valid token and
 *      workspace are set."
 *
 *   2. "Given the user enters a syntactically plausible token, When
 *      they choose 'Test token', Then the app calls Asana to validate
 *      it and reports success (with the workspaces the token can
 *      access) or a specific failure reason (invalid token, network
 *      error, insufficient permission)."
 *
 *   3. "Given a token has been validated, When the user chooses
 *      persistent storage, Then the app explains that the token is
 *      sensitive, states the storage risk and that it remains on this
 *      device/browser profile, and requires an explicit confirmation
 *      step before writing it to IndexedDB."
 *
 *   5. "Given a validated token, When the user views the list of
 *      accessible workspaces, Then they can select exactly one
 *      workspace to use for reporting, and that choice is what scopes
 *      all subsequent data retrieval."
 *
 * And FR-001 ("The system MUST require a user-supplied Asana personal
 * access token before any reporting screen is accessible").
 *
 * What this module owns
 * ---------------------
 * The first-run UI composition the live `/` route renders while the
 * T046 route guard is closed. The composition orchestrates the three
 * existing Phase 3 components in their documented order:
 *
 *   1. `<TokenEntryForm />` (T041) — accepts the user's PAT, runs the
 *      `testToken` validation, runs `listWorkspaces` to fetch the
 *      workspaces the token can access, and surfaces the validated
 *      token + workspace list via its `onValidated` callback.
 *   2. `<StorageModeSelector />` (T042) — drives the FR-002 / FR-003 /
 *      FR-005a / FR-006 confirmation gate and writes either a session
 *      or persistent record through `useCredentials().setSessionToken`
 *      / `setPersistentToken`. The selector emits `onModeSelected`
 *      after the mode is committed so the composition can advance.
 *   3. `<WorkspaceSelector />` (T043) — drives the FR-011 single-
 *      select workspace picker and writes the selection through
 *      `useWorkspace().selectWorkspace`. Selection transitions the
 *      workspace context to `'ready'`, the credentials context was
 *      already ready after step 2, and the route guard's gate lifts.
 *
 * The phase machine is intentionally local to this component (a
 * `useState<Phase>`) rather than a context. The state is a UI-only
 * concern — once the gate lifts, this composition unmounts and the
 * state is discarded. On the next first-run (FR-002b / FR-007
 * decrypt-failure or `clearAll` flow), the composition remounts at
 * `phase === 'token'`.
 *
 * Why this lives in `src/features/credentials/**`
 * -----------------------------------------------
 * The composition is the credential-feature's first-run surface; it
 * imports the three existing feature components and adds an
 * orchestration layer on top. The shell (`src/app/router.tsx`'s
 * `FirstRunRoute`) mounts this component without knowing about the
 * three underlying primitives — the architectural convention is that
 * the shell mounts feature components as opaque surfaces and never
 * composes them.
 *
 * Boundary
 * --------
 * `src/features/credentials/**` is a feature component boundary the
 * plan documents as the home for the credential-flow React UI. This
 * module imports from:
 *
 *   - `../../app/credentials-context` — the `useCredentials()` hook
 *     the shell mounts (T031). Used for the credential-status block
 *     that mirrors what the rest of the app sees through the same
 *     context.
 *   - `../../app/workspace-context` — the `useWorkspace()` hook for
 *     the workspace-status block.
 *   - `../../shared/components/MaskedToken` — the shared masked-
 *     token rendering primitive (T044). The status block uses it so
 *     the FR-008 invariant is honoured at this composition's surface
 *     too — the full plaintext token never appears in the rendered
 *     DOM, even when the user has just typed it.
 *   - `../../shared/states/FirstRunState` — the shared `'first_run'`
 *     ViewState primitive (T032). Carries the `data-view-state="first_run"`
 *     sentinel the route guard's T035 integration test anchors on; the
 *     composition MUST keep rendering it so a regression that drops
 *     the gate sentinel fails that test.
 *   - `./TokenEntry`, `./StorageModeSelector`, `./WorkspaceSelector` —
 *     the three existing Phase 3 components. The composition does NOT
 *     re-implement their behaviour; it composes them.
 *
 * Determinism
 * -----------
 * The composition is fully synchronous on first paint (no async init,
 * no IndexedDB read beyond what the existing providers do). The phase
 * machine advances only in response to explicit user actions (token
 * validation success, storage-mode commit, workspace-selection commit)
 * so re-renders are deterministic given the same user inputs. The
 * validated token is held in local component state for the lifetime of
 * the composition so the `StorageModeSelector` can pass it through to
 * the credentials context on the user's storage-mode choice.
 *
 * URL / log / value safety (FR-008)
 * ---------------------------------
 * The plaintext token is held in local `useState` and only ever passed
 * to the three child components through their documented prop
 * surfaces (the same surfaces their unit tests pin). It is never
 * echoed through the URL, the document title, the rendered DOM, or a
 * log line. The status block renders the credentials context's
 * `maskedIdentifier` via `<MaskedToken />` so the rendered surface
 * never displays the full token, even after a successful validation.
 */
import { useCallback, useState, type ReactElement } from "react";

import { useCredentials } from "../../app/credentials-context";
import { useWorkspace } from "../../app/workspace-context";
import { MaskedToken } from "../../shared/components/MaskedToken";
import { FirstRunState } from "../../shared/states/FirstRunState";
import { StorageModeSelector } from "./StorageModeSelector";
import { TokenEntryForm, type ValidatedToken } from "./TokenEntry";
import { WorkspaceSelector } from "./WorkspaceSelector";

/**
 * The internal three-step phase machine the composition walks through.
 * Each transition fires from a Phase 3 component callback:
 *
 *   `'token' → 'mode'`: `TokenEntryForm.onValidated` (the token
 *      validated AND the workspace list came back non-empty).
 *   `'mode' → 'workspace'`: `StorageModeSelector.onModeSelected` (the
 *      credentials context committed either session or persistent).
 *
 * The third transition — `'workspace' → unmount` — is implicit: the
 * `WorkspaceSelector` calls `useWorkspace().selectWorkspace`, which
 * resolves the workspace context to `'ready'`. Both providers being
 * `'ready'` lifts the route guard's gate, and this composition
 * unmounts in favour of the reporting surface.
 */
type Phase = "token" | "mode" | "workspace";

/**
 * The first-run UI composition the live `/` route renders while the
 * T046 route guard is closed. Self-contained — no props, no external
 * hooks beyond the two contexts the shell already mounts.
 *
 * Renders in this order:
 *
 *   1. `<FirstRunState />` — the shared `'first_run'` ViewState
 *      primitive (heading + onboarding nudge + the
 *      `data-view-state="first_run"` sentinel the gate contract pins).
 *   2. The credential/workspace status block — a "current state"
 *      panel the user can rely on across the three phases. It reads
 *      `useCredentials().maskedIdentifier` and
 *      `useWorkspace().workspace` so the panel always reflects the
 *      persisted state (or the empty / first-run state) rather than
 *      the local phase machine.
 *   3. The phase-appropriate Phase 3 component.
 */
export function FirstRunSetup(): ReactElement {
  const credentials = useCredentials();
  const workspace = useWorkspace();
  const [phase, setPhase] = useState<Phase>("token");
  const [validated, setValidated] = useState<ValidatedToken | null>(null);

  const handleValidated = useCallback((next: ValidatedToken): void => {
    setValidated(next);
    setPhase("mode");
  }, []);

  const handleModeSelected = useCallback((): void => {
    setPhase("workspace");
  }, []);

  const hasMaskedIdentifier = credentials.maskedIdentifier.length > 0;
  const hasWorkspace = workspace.workspace !== null;

  return (
    <main className="team-dash-shell team-dash-shell--first-run" lang="en-AU">
      <FirstRunState />
      <section
        className="td-first-run-credential-status"
        aria-label="Current credential and workspace"
      >
        <p>
          Current credential:{" "}
          {hasMaskedIdentifier ? (
            <MaskedToken maskedIdentifier={credentials.maskedIdentifier} />
          ) : (
            <em>not set</em>
          )}
        </p>
        <p>
          Current workspace:{" "}
          {hasWorkspace ? (
            <code>{workspace.workspace?.name}</code>
          ) : (
            <em>not selected</em>
          )}
        </p>
      </section>
      {phase === "token" && <TokenEntryForm onValidated={handleValidated} />}
      {phase === "mode" && validated !== null && (
        <StorageModeSelector
          token={validated.token}
          maskedIdentifier={validated.maskedIdentifier}
          onModeSelected={handleModeSelected}
        />
      )}
      {phase === "workspace" && validated !== null && (
        <WorkspaceSelector workspaces={validated.workspaces} />
      )}
    </main>
  );
}
