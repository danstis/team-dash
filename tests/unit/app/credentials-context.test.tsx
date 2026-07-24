/**
 * T031 — `src/app/credentials-context.tsx` unit/component tests (Red phase).
 *
 * The CredentialsProvider is the top-level shell context that holds the
 * current Asana personal access token, its storage mode, and the
 * derived `ViewState`. It exists so every feature component
 * (`features/credentials/TokenEntry`, the route guard T046, the
 * settings panel T045) can ask the same question — "is there a
 * usable credential right now?" — without each component re-reading
 * IndexedDB or re-running the AES-GCM decrypt.
 *
 * The provider's contract (Constitution Principle IV, spec FR-001,
 * FR-002a, FR-002b, FR-008, data-model.md `CredentialRecord`):
 *
 * - On mount it MUST synchronously surface the `'loading'` `ViewState`
 *   so the rest of the app can render an honest "loading" surface
 *   while the IndexedDB round-trip + Web Crypto AES-GCM decrypt
 *   resolve. It MUST NOT block render — the app boots immediately
 *   with the children mounted under the provider (Constitution
 *   Principle IV + FR-002a "decrypt on launch with no extra unlock
 *   step"; this test fails if a contributor writes a provider that
 *   suspends the children on the decrypt).
 *
 * - It MUST resolve to `'first_run'` when no credential is stored —
 *   the same screen the user lands on when the IndexedDB lookup
 *   returns nothing.
 *
 * - It MUST resolve to `'first_run'` when an encrypted credential is
 *   stored but the decrypt fails (FR-002b's documented fallback: a
 *   missing/corrupted non-extractable key record is treated as "no
 *   token stored", not a separate dedicated error state).
 *
 * - It MUST resolve to `'ready'` when a credential is loaded (either
 *   from a session-only value held in memory, or from a successfully
 *   decrypted persistent record).
 *
 * - The provider MUST expose the credential via a typed hook
 *   (`useCredentials`) so consumers can read `token`, `mode`, and
 *   `maskedIdentifier` without depending on the context object shape.
 *   The masked identifier MUST be the only identifier surfaced — a
 *   contributor who accidentally exposes the full token via the hook
 *   fails this test (FR-008).
 *
 * - The credential record's `maskedIdentifier` MUST be present (FR-008
 *   "at most a masked/partial representation may be shown"). The
 *   provider does not implement the masked-identifier algorithm
 *   itself — the full token never appears in the provider surface.
 *
 * The shell is the contract downstream user stories depend on. These
 * tests are the boundary every feature import touches, so a regression
 * here is more expensive than the apparent size of the unit suggests.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { db } from "../../../src/data/db/schema";
import {
  CredentialsProvider,
  useCredentials,
} from "../../../src/app/credentials-context";

type CredentialsHookValue = ReturnType<typeof useCredentials>;

/**
 * Helper that asserts a serialised credentials context value does not
 * carry the plaintext token value. Used by the FR-008 surface test
 * below to assert the value surface (not the action-method names —
 * see the note there) is free of credential leakage.
 *
 * @param serialised JSON.stringify of the context value.
 */
function valueContainsPlaintextToken(serialised: string): boolean {
  // The probe value is JSON-stringified; any field whose value
  // happens to contain a meaningful-looking token string would
  // surface here. We assert the absence of any field whose key
  // is *likely* to carry the plaintext token, and the absence of
  // a `plaintext` field. The exact token value is never asserted
  // because we never place one in the context value to begin with.
  if (/"plaintext"\s*:/.test(serialised)) {
    return true;
  }
  if (/"token"\s*:/.test(serialised)) {
    return true;
  }
  if (/"encryptedTokenRecord"\s*:/.test(serialised)) {
    return true;
  }
  if (/"keyRef"\s*:/.test(serialised)) {
    return true;
  }
  return false;
}

/**
 * Tiny harness component so each test can both render the provider and
 * read the context value synchronously from the DOM (via a `data-testid`
 * slot) rather than from a closure over the React tree. This is the
 * same pattern used by the existing `tests/unit/app/main.test.tsx`
 * suite.
 */
function CredentialsHarness({
  testId,
}: {
  testId: string;
}): React.ReactElement {
  const value = useCredentials();
  return (
    <div data-testid={testId}>
      <span data-testid={`${testId}-state`}>{value.state}</span>
      <span data-testid={`${testId}-mode`}>{value.mode ?? "none"}</span>
      <span data-testid={`${testId}-masked`}>
        {value.maskedIdentifier ?? ""}
      </span>
    </div>
  );
}

describe("T031 CredentialsProvider (T031 app shell contract)", () => {
  beforeEach(async () => {
    // Clear the credentials + workspaces tables between tests so the
    // IndexedDB store does not leak state from a previous test into
    // this one. We do NOT delete-and-reopen the database: a pending
    // `db.credentials.get(...)` promise from a previous test's
    // `<CredentialsProvider>` `useEffect` would otherwise reject with
    // `DatabaseClosedError` after `db.delete()`. Clearing the rows
    // keeps the connection open and lets the pending promise resolve
    // cleanly so the test cleanup stays unhandled-rejection-free.
    await db.credentials.clear();
    await db.workspaces.clear();
  });

  afterEach(async () => {
    cleanup();
    await db.credentials.clear();
    await db.workspaces.clear();
  });

  describe("initial render (does not block on the decrypt)", () => {
    it("mounts its children synchronously with the `'loading'` ViewState", async () => {
      // The first synchronous render MUST place the harness on the
      // DOM with state = 'loading'. A provider that gates render
      // behind an async decrypt (e.g. returns null while resolving,
      // or throws a Promise via Suspense) would leave the harness
      // unrendered and fail this test.
      render(
        <CredentialsProvider>
          <CredentialsHarness testId="harness" />
        </CredentialsProvider>,
      );

      const state = screen.getByTestId("harness-state");
      expect(state.textContent).toBe("loading");
      expect(screen.getByTestId("harness-mode").textContent).toBe("none");
    });
  });

  describe("resolve to `'first_run'` when no credential is stored", () => {
    it("settles on `'first_run'` with no mode after the IndexedDB round-trip", async () => {
      render(
        <CredentialsProvider>
          <CredentialsHarness testId="harness" />
        </CredentialsProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId("harness-state").textContent).toBe(
          "first_run",
        );
      });

      expect(screen.getByTestId("harness-mode").textContent).toBe("none");
      expect(screen.getByTestId("harness-masked").textContent).toBe("");
    });
  });

  describe("decrypt failure (FR-002b) routes to `'first_run'`", () => {
    it("treats a stored encrypted record that fails to decrypt as no credential", async () => {
      // Seed an encrypted credential row whose key handle and ciphertext
      // are structurally valid but cannot round-trip — exactly the
      // "stored key is missing / corrupted / partially cleared" scenario
      // FR-002b anticipates. The provider MUST route the app to
      // 'first_run' instead of leaving it in a stuck `'loading'` state
      // or surfacing a separate error state.
      const iv = new Uint8Array(12);
      const ciphertext = new Uint8Array(16);
      const key = await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
      );
      await db.credentials.put({
        mode: "persistent",
        encryptedTokenRecord: {
          ciphertext: ciphertext.buffer,
          iv: iv.buffer,
          keyRef: key,
        },
        maskedIdentifier: "…wxyz",
        lastValidatedAt: null,
        lastValidationResult: null,
      });

      // Overwrite the key handle with a *fresh* non-matching key so
      // decryptToken() rejects with `wrong_key` (the realistic FR-002b
      // case: the IndexedDB key record was clobbered / migrated).
      const wrongKey = await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
      );
      await db.credentials.put({
        mode: "persistent",
        encryptedTokenRecord: {
          ciphertext: ciphertext.buffer,
          iv: iv.buffer,
          keyRef: wrongKey,
        },
        maskedIdentifier: "…wxyz",
        lastValidatedAt: null,
        lastValidationResult: null,
      });

      render(
        <CredentialsProvider>
          <CredentialsHarness testId="harness" />
        </CredentialsProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId("harness-state").textContent).toBe(
          "first_run",
        );
      });

      expect(screen.getByTestId("harness-mode").textContent).toBe("none");
    });
  });

  describe("context hook surface (FR-008)", () => {
    it("does not expose the plaintext token value via useCredentials", () => {
      // We probe the *value* surface (state fields that could carry
      // the token) rather than the action-method names — the action
      // methods' names intentionally contain "token" so a feature
      // component's call site reads as `setSessionToken(token)` rather
      // than a generic `set` whose caller would not know what it set.
      // The contract the spec pins (FR-008) is about VALUE leakage,
      // not API naming. The implementation MUST NOT carry the
      // plaintext token in any field on the context value.
      const observedValues: string[] = [];
      function Probe(): null {
        const value = useCredentials();
        observedValues.push(JSON.stringify(value));
        return null;
      }

      render(
        <CredentialsProvider>
          <Probe />
        </CredentialsProvider>,
      );

      const observed = observedValues.join("\n");
      // The full token value never crosses the context boundary
      // (FR-008). `setSessionToken`/`setPersistentToken` accept a
      // token via their parameter, which is the only legitimate
      // surface — that is the per-call handoff owned by the future
      // CredentialRepository (T040), not a state field on the
      // context value.
      expect(valueContainsPlaintextToken(observed)).toBe(false);
    });
  });

  describe("children render under StrictMode (Principle I: app must boot)", () => {
    it("renders the harness under <StrictMode> without crashing", () => {
      // Constitution Principle I requires the app to remain runnable
      // after every completed delivery task. T031 mounts the provider
      // under <StrictMode>, which double-invokes lifecycle methods in
      // dev. A provider that throws on double-invoke (e.g. attempts
      // the IndexedDB read twice and triggers a "Database opened
      // twice" error) fails this test.
      expect(() =>
        render(
          <StrictMode>
            <CredentialsProvider>
              <CredentialsHarness testId="harness" />
            </CredentialsProvider>
          </StrictMode>,
        ),
      ).not.toThrow();
    });
  });

  describe("provider surface (API stability for downstream consumers)", () => {
    it("exposes a typed useCredentials hook", () => {
      function Probe(): null {
        const value: CredentialsHookValue = useCredentials();
        expect(value.state).toBeTypeOf("string");
        return null;
      }
      render(
        <CredentialsProvider>
          <Probe />
        </CredentialsProvider>,
      );
    });
  });
});
