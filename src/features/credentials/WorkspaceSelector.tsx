/**
 * T043 — `WorkspaceSelector` (US1, BSOD-171).
 *
 * Spec / contract references
 * --------------------------
 * US1 acceptance scenario 5 (spec.md §"User Story 1", FR-011):
 *
 *   "Given a validated token, When the user views the list of
 *    accessible workspaces, Then they can select exactly one workspace
 *    to use for reporting, and that choice is what scopes all
 *    subsequent data retrieval."
 *
 * FR-011 itself: "the system MUST let the user choose one Asana
 * workspace from those accessible to the validated token, and MUST
 * scope all data retrieval and reporting to that chosen workspace."
 *
 * What this module owns
 * ---------------------
 * - A native `<select>` single-select control (`multiple` is
 *   `false` by default and never set to `true`) that renders one
 *   `<option>` per workspace the validated token can access. The
 *   native control handles the keyboard semantics (arrow-key
 *   navigation, type-ahead, screen-reader announcement via the
 *   combobox role) without a custom focus-trap implementation.
 * - A two-step commit flow: changing the `<select>` value updates
 *   local state only; the user must press the explicit "Select
 *   workspace" button before any Dexie write. This mirrors the
 *   two-step pattern in T042's `StorageModeSelector` (radio change
 *   → confirmation dialog) so the credential flow never races ahead
 *   of an explicit user action.
 * - An explicit empty-state surface for the token-has-no-workspaces
 *   case (spec clarification: "A workspace the token can access has
 *   zero projects, or the token has zero accessible workspaces: the
 *   app must state this rather than showing an empty table with no
 *   explanation").
 * - Persistence through `useWorkspace().selectWorkspace`, which
 *   resolves the workspace context to `'ready'` and writes the
 *   selection to the Dexie `workspaces` store.
 *
 * What this module deliberately does NOT own
 * ------------------------------------------
 * - The "list accessible workspaces" network call: that is T039
 *   (`listWorkspaces` in `src/data/asana/client.ts`). The selector
 *   receives the resolved list via the `workspaces` prop so the
 *   network-acquisition boundary stays one-way.
 * - The credential write path: the selector never touches
 *   `useCredentials` and never receives a token. FR-008 is pinned
 *   by the prop signature itself — a future contributor who tries
 *   to add a `token` prop fails the type-check the moment they
 *   declare the field.
 * - The route guard that decides whether the selector is reachable
 *   in the first place: that is T046's deliverable. Until T046
 *   ships, the selector is mounted by whoever composes the first-run
 *   surface (the eventual `<App />` wiring, a Settings panel
 *   route, or a development page).
 * - The `ISODateTime` brand at the type level: the selector
 *   constructs a plain ISO string via `new Date().toISOString()` and
 *   hands it to `selectWorkspace`. The brand exists only at the
 *   presentation/contract layer and the cast below mirrors the
 *   `WorkspaceProvider`'s documented "Dexie round-trip drops the
 *   brand" cast.
 *
 * URL / log / value safety (FR-008)
 * ---------------------------------
 * The selector's prop surface does NOT include a `token` field. The
 * rendered DOM never echoes a token even when the caller supplies
 * one via a future type-widening regression — the test
 * `exposes no token-shaped prop surface (FR-008 contract)` pins this
 * invariant. The token lives in `useCredentials` only; the selector
 * reads nothing from that context.
 *
 * Boundary
 * --------
 * `src/features/credentials/**` is a feature component boundary the
 * plan documents as the home for the credential-flow React UI.
 * This module imports from:
 *   - `../../app/workspace-context` — the `useWorkspace` hook the
 *     shell mounts (T031).
 *   - `../../data/asana/schemas` — the `asanaWorkspaceSchema` type
 *     the prop signature exposes so downstream feature tests can
 *     build fixtures without re-deriving the workspace shape.
 *
 * It does NOT import from `src/domain/**` (the ESLint boundary
 * enforced by `eslint.config.js` rejects a domain import here — the
 * `ISODateTime` cast is inline because the brand exists only at the
 * presentation layer). It does NOT import from `src/data/asana/**`
 * directly; the workspaces list comes in as a prop so the
 * network-acquisition boundary stays one-way.
 */
import {
  useCallback,
  useEffect,
  useId,
  useState,
  type ChangeEvent,
  type ReactElement,
} from "react";
import type { z } from "zod";

import {
  useWorkspace,
  type SelectedWorkspace,
} from "../../app/workspace-context";
import type { asanaWorkspaceSchema } from "../../data/asana/schemas";

/**
 * The shape the selector accepts as its `workspaces` prop. Aliased
 * to the Zod-inferred `asanaWorkspaceSchema` so any future Asana-side
 * workspace field added to the schema automatically widens the
 * selector's prop type at the type level.
 */
export type WorkspaceOption = z.infer<typeof asanaWorkspaceSchema>;

export interface WorkspaceSelectorProps {
  /**
   * The workspaces the validated token can access (FR-011). Passed
   * in as a prop so the network-acquisition boundary
   * (`src/data/asana/**`, `listWorkspaces`) stays one-way: the
   * selector never fetches, the caller does. An empty array renders
   * the explicit empty-state surface rather than a silent blank
   * `<select>`.
   */
  readonly workspaces: readonly WorkspaceOption[];
  /**
   * Fired with the chosen workspace after the user confirms via the
   * explicit "Select workspace" button. The callback fires after
   * `selectWorkspace` resolves so a parent that needs to advance to
   * the next step (storage mode, route guard) can do so without
   * racing the IndexedDB write.
   */
  readonly onSelected?: (workspace: WorkspaceOption) => void;
}

/**
 * The single-select workspace picker. Renders a native `<select>`
 * with one `<option>` per workspace and an explicit "Select
 * workspace" button that commits the choice through
 * `useWorkspace().selectWorkspace`. Renders an explicit
 * empty-state surface when the workspace list is empty so the
 * token-has-no-workspaces case is communicated instead of silently
 * rendered as a blank control.
 */
export function WorkspaceSelector({
  workspaces,
  onSelected,
}: Readonly<WorkspaceSelectorProps>): ReactElement {
  const workspaceContext = useWorkspace();
  const [selectedGid, setSelectedGid] = useState<string>(
    workspaceContext.workspace?.gid ?? "",
  );
  const [pending, setPending] = useState<boolean>(false);
  const labelId = useId();

  // The Settings "switch workspace" flow re-mounts this component
  // with a different workspace already selected in the context. Sync
  // the local state with the context so the rendered `<select>` does
  // not show a stale value while the context advances underneath.
  // The effect intentionally depends on `workspaceContext.workspace`
  // alone — including `selectedGid` in the dependency array would
  // race the user's change handler (the effect would re-run after
  // every keystroke-equivalent and reset the user's pending choice
  // back to whatever the context currently holds, even before
  // `selectWorkspace` resolves).
  useEffect(() => {
    setSelectedGid(workspaceContext.workspace?.gid ?? "");
  }, [workspaceContext.workspace]);

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>): void => {
      setSelectedGid(event.target.value);
    },
    [],
  );

  const handleConfirm = useCallback(async (): Promise<void> => {
    if (pending || selectedGid === "") {
      return;
    }
    const next = workspaces.find((workspace) => workspace.gid === selectedGid);
    if (next === undefined) {
      // The `<select>` only offers valid `gid`s from the `workspaces`
      // prop, so reaching here implies the prop list shrank while
      // the user held an option. Refuse rather than writing a stale
      // selection — the Settings "clear all" path is the documented
      // way to clear the workspace context.
      return;
    }
    setPending(true);
    try {
      // The `selectedAt` field is stored in IndexedDB as a plain
      // string; the `ISODateTime` brand exists only at the
      // presentation/contract layer. The cast mirrors
      // `WorkspaceProvider.selectWorkspace`'s documented behaviour
      // and is safe because `new Date().toISOString()` returns the
      // exact shape the contract requires.
      const selectedWorkspace: SelectedWorkspace = {
        gid: next.gid,
        name: next.name,
        selectedAt: new Date().toISOString() as SelectedWorkspace["selectedAt"],
      };
      await workspaceContext.selectWorkspace(selectedWorkspace);
      onSelected?.(next);
    } finally {
      setPending(false);
    }
  }, [onSelected, pending, selectedGid, workspaceContext, workspaces]);

  if (workspaces.length === 0) {
    return (
      <section
        className="td-workspace-selector td-workspace-selector--empty"
        data-testid="workspace-selector-empty"
        aria-labelledby={labelId}
      >
        <h3 id={labelId}>Choose a workspace</h3>
        {/* SonarQube typescript:S6819 — use the native <output> element
            (whose implicit ARIA role is "status") instead of overlaying
            role="status" on a <p> so the empty-state copy is announced
            consistently across assistive technology and the lint rule
            stays green. */}
        <output>
          No accessible workspaces were returned for this token. Confirm the
          token has at least one workspace membership, then test the token
          again.
        </output>
      </section>
    );
  }

  const isConfirmDisabled =
    pending ||
    selectedGid === "" ||
    selectedGid === (workspaceContext.workspace?.gid ?? "");

  return (
    <fieldset
      className="td-workspace-selector"
      data-testid="workspace-selector"
      disabled={pending}
    >
      <legend>Workspace</legend>
      <p>
        Choose the Asana workspace you want to report on. This scopes every
        task, project, and portfolio the dashboard retrieves to the chosen
        workspace.
      </p>
      <label>
        <span>Workspace</span>
        <select
          aria-label="Workspace"
          value={selectedGid}
          onChange={handleChange}
          disabled={pending}
        >
          <option value="" disabled>
            Select a workspace
          </option>
          {workspaces.map((workspace) => (
            <option key={workspace.gid} value={workspace.gid}>
              {workspace.name}
              {workspace.is_organization === true ? " (organisation)" : ""}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        data-variant="primary"
        onClick={() => void handleConfirm()}
        disabled={isConfirmDisabled}
      >
        {pending ? "Selecting workspace…" : "Select workspace"}
      </button>
    </fieldset>
  );
}
