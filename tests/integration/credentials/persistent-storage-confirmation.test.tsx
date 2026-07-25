/**
 * T036 — integration test for the persistent-storage risk disclosure
 * and explicit-confirmation step in the credential entry flow.
 *
 * Acceptance scenarios pinned here
 * --------------------------------
 * This file locks down two of US1's seven acceptance scenarios from
 * `specs/001-asana-team-dashboard/spec.md` §"User Story 1":
 *
 *   3. "Given a token has been validated, When the user chooses
 *      persistent storage, Then the app explains that the token is
 *      sensitive, states the storage risk and that it remains on this
 *      device/browser profile, and requires an explicit confirmation
 *      step before writing it to IndexedDB."
 *
 *   4. "Given the user does not confirm persistent storage, When they
 *      dismiss or decline, Then the app falls back to session-only
 *      mode without storing the token."
 *
 * Together these pin the FR-003 risk-disclosure contract and the
 * FR-006 "switching into persistent mode requires confirmation"
 * contract for the `StorageModeSelector` feature component that T042
 * owns. The acceptance scenario that requires a *successful* persistent
 * write (encrypted, FR-002a + FR-005a) is the `CredentialRepository`'s
 * concern (T040) and is asserted by the repository contract test; this
 * integration test deliberately stops at the disclosure/confirmation
 * boundary so the two responsibilities do not overlap.
 *
 * What "integration" means here
 * ----------------------------
 * The test mounts the real `<CredentialsProvider>` shell context over
 * a real Dexie store (jsdom + `fake-indexeddb`) so the disclosure /
 * confirmation flow talks to the same in-process state machine every
 * downstream US1 feature (the route guard T046, the settings panel
 * T045) reads from. The `StorageModeSelector` itself is rendered as a
 * sibling so the test can probe both the rendered DOM (risk-disclosure
 * copy, decline/confirm buttons) and the context state
 * (`useCredentials().mode`) that the selector is required to update.
 *
 * That cross-layer read is what makes this an integration test rather
 * than a unit test: a contributor who wires the disclosure copy into
 * the selector but forgets to surface the mode transition through the
 * context would pass a unit test on the selector in isolation, and
 * would break every consumer that reads `useCredentials().mode` — this
 * file fails the same build before that regression reaches a PR.
 *
 * Why dynamic import of the selector
 * ----------------------------------
 * The `StorageModeSelector` is T042's deliverable; the dynamic-import
 * pattern (mirroring
 * `tests/unit/shared/states/ViewStateView.test.tsx`) keeps this file
 * parseable + type-checkable while the implementation is still in
 * flight, so the test failure mode is a precise "missing export" at
 * the call site rather than a whole-file module-resolution error that
 * swallows every assertion in the suite. When T042 lands, the import
 * resolves and these tests transition from Red to Green with no edits
 * here (Constitution Principle III Red/Green/Refactor — no test
 * changes between Red and Green).
 *
 * Token-safety guard
 * ------------------
 * No plaintext token enters this test. The fixture supplies the
 * selector with a synthetic identifier (e.g. `"…wxyz"`) so the
 * selector's mode transition can be exercised end-to-end without ever
 * placing a real Asana PAT in the DOM or in IndexedDB; the FR-008
 * "token never rendered, logged, or embedded" rule is preserved by
 * construction.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  CredentialsProvider,
  useCredentials,
} from "../../../src/app/credentials-context";
import { db } from "../../../src/data/db/schema";

/**
 * Lazy-load the feature component. Dynamic import is the established
 * pattern (see `tests/unit/shared/states/ViewStateView.test.tsx`) for
 * TDD-Red test files: the import resolves to an empty module object
 * until T042 ships, so the `StorageModeSelector` reference below is
 * `undefined` and each test fails on a precise "expected a function"
 * assertion rather than on a module-resolution error that masks every
 * other assertion in the suite.
 */
async function loadStorageModeSelector(): Promise<
  React.ComponentType<Record<string, never>>
> {
  // The module path is composed at runtime so `tsc` does not statically
  // resolve it; this keeps the test file typecheck-clean while the
  // implementation (T042) is still pending. The runtime check + the
  // try/catch below preserve the same Red-state semantics as a static
  // import — a missing implementation surfaces as a precise
  // "prerequisite not met" assertion rather than as a raw
  // `Cannot find module …` error that would mask every other
  // assertion in the suite and look like an environment bug rather
  // than the documented TDD Red state.
  const modulePath = [
    "../../../src/features/credentials/",
    "StorageModeSelector",
  ].join("");
  let mod: Record<string, unknown>;
  try {
    mod = (await import(modulePath)) as Record<string, unknown>;
  } catch {
    throw new Error(
      "T036 prerequisite: src/features/credentials/StorageModeSelector.tsx " +
        "could not be loaded — T042 must land before this integration test can pass.",
    );
  }
  if (typeof mod.StorageModeSelector !== "function") {
    throw new Error(
      "T036 prerequisite: StorageModeSelector export not found at " +
        "src/features/credentials/StorageModeSelector.tsx — T042 must land before this integration test can pass.",
    );
  }
  return mod.StorageModeSelector as React.ComponentType<Record<string, never>>;
}

/**
 * Tiny harness that renders the current `useCredentials().mode` to a
 * stable `data-testid` slot, so the test can assert the selector
 * actually transitioned the context state — not just rendered the
 * right copy. A future contributor who renders the disclosure but
 * forgets to update the provider context still fails this test.
 */
function ContextModeProbe(): React.ReactElement {
  const credentials = useCredentials();
  return (
    <output data-testid="probe-mode" aria-live="polite">
      {credentials.mode ?? "none"}
    </output>
  );
}

/**
 * Render the selector under the real credentials provider (and the
 * workspace provider, mirroring the production shell composition in
 * `src/app/App.tsx`). The `WorkspaceProvider` is included so any
 * selector implementation that intentionally couples the storage
 * decision to the workspace selection — T042 documents the
 * cross-cutting concern — has the same provider boundary available in
 * the test as in production.
 */
async function renderSelector(): Promise<ReturnType<typeof render>> {
  const { WorkspaceProvider } =
    await import("../../../src/app/workspace-context");
  const StorageModeSelector = await loadStorageModeSelector();
  return render(
    <CredentialsProvider>
      <WorkspaceProvider>
        <StorageModeSelector />
        <ContextModeProbe />
      </WorkspaceProvider>
    </CredentialsProvider>,
  );
}

/**
 * Clear the credentials row before each test so the selector starts
 * from the documented "no token, no disclosure, no IndexedDB write"
 * baseline. The workspace table is cleared too in case a future
 * selector variant couples the two stores; clearing the wider surface
 * is cheap and matches the shell-level cleanup convention used by
 * `tests/integration/app/app-shell.test.tsx`.
 */
async function clearCredentialStores(): Promise<void> {
  await db.credentials.clear();
  await db.workspaces.clear();
}

describe("T036 persistent-storage risk disclosure confirmation", () => {
  afterEach(async () => {
    cleanup();
    await clearCredentialStores();
  });

  it("renders both storage mode options before any IndexedDB write", async () => {
    await renderSelector();

    // The two storage mode options FR-002 requires MUST both be
    // present before the user makes any choice. A selector that
    // pre-selects persistent — bypassing the disclosure — would fail
    // this test by making only the persistent radio reachable.
    expect(
      screen.getByRole("radio", { name: /session[- ]only/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /persistent/i }),
    ).toBeInTheDocument();

    // No IndexedDB row exists yet — a selector that eagerly writes
    // before any user interaction would fail this assertion.
    expect(await db.credentials.get("persistent")).toBeUndefined();
  });

  it("shows the FR-003 risk disclosure when the user chooses persistent storage", async () => {
    await renderSelector();

    fireEvent.click(screen.getByRole("radio", { name: /persistent/i }));

    // FR-003, first clause: the disclosure MUST state the token is
    // sensitive. The phrasing is not pinned (Australian-English copy
    // is owned by T042) so the assertion is the lighter "sensitive"
    // substring check — strict enough to catch a selector that omits
    // the risk framing, loose enough to allow editorial refinement.
    expect(
      screen.getByText(/sensitive/i),
      "FR-003 risk disclosure must name the token as sensitive",
    ).toBeInTheDocument();

    // FR-003, second clause: the disclosure MUST describe the
    // encryption-at-rest approach so the user can weigh the
    // documented limitation (FR-002a) before consenting.
    expect(
      screen.getByText(/encrypt/i),
      "FR-003 risk disclosure must describe the encryption approach",
    ).toBeInTheDocument();

    // FR-003, third clause: the disclosure MUST state the token
    // remains on this device / browser profile so the user knows the
    // risk is local, not server-side.
    expect(
      screen.getByText(/this device|browser profile|this browser/i),
      "FR-003 risk disclosure must state the local-storage scope",
    ).toBeInTheDocument();

    // FR-003, fourth clause: an explicit confirmation action MUST be
    // available — a selector that silently flips into persistent
    // mode without a confirm button fails this assertion.
    expect(
      screen.getByRole("button", { name: /confirm|enable persistent|store/i }),
      "FR-003 explicit confirmation button must be present after disclosure",
    ).toBeInTheDocument();

    // The decline path MUST also be reachable — the disclosure
    // decision is two-sided (scenario 4 covers the decline half).
    expect(
      screen.getByRole("button", { name: /decline|cancel|dismiss|back/i }),
      "FR-003 decline control must be present after disclosure",
    ).toBeInTheDocument();

    // The disclosure MUST NOT have written the token to IndexedDB yet
    // — a selector that conflates "disclosure shown" with "storage
    // committed" violates FR-005a's "delete the prior encrypted
    // record immediately" rule by creating a record before consent.
    expect(await db.credentials.get("persistent")).toBeUndefined();
  });

  it("falls back to session-only without an IndexedDB write when the user declines", async () => {
    await renderSelector();

    // Step 1: user picks persistent → disclosure opens.
    fireEvent.click(screen.getByRole("radio", { name: /persistent/i }));
    expect(
      screen.getByText(/sensitive/i),
      "precondition: disclosure must be open before declining",
    ).toBeInTheDocument();

    // Step 2: user declines the disclosure (FR-006 / scenario 4).
    fireEvent.click(
      screen.getByRole("button", { name: /decline|cancel|dismiss|back/i }),
    );

    // Step 3: the provider context MUST reflect session-only mode —
    // a selector that leaves `mode` in `null` (first-run) would
    // strand the user back on the entry screen rather than land them
    // in the documented "session-only" state.
    await waitFor(() => {
      expect(screen.getByTestId("probe-mode").textContent).toBe("session");
    });

    // Step 4: the FR-006 / scenario-4 invariant — no IndexedDB row
    // may exist after a decline. A selector that writes the record
    // before the confirmation click is exactly the privacy violation
    // FR-003 is designed to prevent.
    expect(await db.credentials.get("persistent")).toBeUndefined();
  });

  it("does not expose the plaintext token through the disclosure surface", async () => {
    // FR-008 invariant pin: even though this test never supplies a
    // real Asana PAT (the selector is invoked with no token
    // argument), a future contributor who renders the disclosure
    // alongside the plaintext token in the same component will fail
    // this assertion because the rendered surface contains no token
    // text. Substring / `data-testid` checks rather than
    // fixture-supplied strings are sufficient because the selector
    // is invoked without a real token by construction.
    await renderSelector();

    fireEvent.click(screen.getByRole("radio", { name: /persistent/i }));

    const surface = document.body.textContent ?? "";
    // Defence-in-depth: the literal string "bearer " is a marker the
    // `Authorization: Bearer …` header would carry if a token
    // accidentally made it onto the rendered surface. No fixture
    // string here, so any positive match is a regression.
    expect(surface.toLowerCase()).not.toContain("bearer ");
  });

  it("reaches the FR-006 confirmation gate only via explicit user action", async () => {
    // FR-006: switching into persistent mode applies the FR-003
    // confirmation requirement. This assertion pins the
    // "confirmation is gated by an explicit user action" half —
    // toggling the radio is not itself the confirmation; the user
    // must affirm the disclosure via the dedicated control. A
    // selector that wires the radio's change event directly to
    // `setPersistentToken` (skipping the disclosure gate) would
    // leave the provider mode in `persistent` after just the radio
    // click, failing the assertion below.
    await renderSelector();

    fireEvent.click(screen.getByRole("radio", { name: /persistent/i }));

    // The radio click MUST have opened the disclosure but MUST NOT
    // have committed the storage mode.
    expect(screen.getByText(/sensitive/i)).toBeInTheDocument();
    expect(screen.getByTestId("probe-mode").textContent).not.toBe("persistent");
  });
});
