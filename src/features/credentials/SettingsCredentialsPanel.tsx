/**
 * T045 — Settings credentials panel.
 *
 * US1 acceptance scenario 6 (spec.md):
 *
 *   "Given an already-configured session, When the user opens Settings,
 *    Then they can test the current token again, replace it, switch
 *    between session-only and persistent storage, or clear the token and
 *    all locally retained Asana data in one explicit action."
 *
 * The panel is the Settings-screen embodiment of the four credential
 * lifecycle actions the spec pins (FR-004, FR-005, FR-005a, FR-006,
 * FR-007). It composes the existing primitives:
 *
 *   - `useCredentials()` (T031, `src/app/credentials-context.tsx`) —
 *     surfaces the current mode + masked identifier and exposes the
 *     credential repository's session / persistent / clear actions.
 *   - `testToken` (T039, `src/data/asana/client.ts`) — the on-demand
 *     validity probe the Retest button composes.
 *
 * The panel holds the plaintext token in a local `useState` for the
 * duration of the user's session with the panel so the four actions
 * can each hand it to the underlying repository without re-asking. The
 * token value is intentionally never echoed back to the surrounding
 * `<CredentialsProvider>` value surface (FR-008); the masked identifier
 * the panel computes via `token.slice(-4)` is the only identifier the
 * provider stores.
 *
 * ## FR-003 disclosure + FR-006 confirmation gate
 *
 * Switching INTO persistent storage surfaces an explicit confirmation
 * dialog (`data-testid="persistent-confirmation"`) before any
 * IndexedDB write. The dialog copy names the encryption-at-rest
 * approach and its stated limitation (FR-002a) and explicitly notes
 * that the token remains on this device / browser profile. Declining
 * closes the dialog without a write; confirming calls the provider's
 * `setPersistentToken`, which encrypts under a freshly-generated
 * non-extractable AES-GCM key (Constitution Principle IV).
 *
 * ## FR-005a immediate deletion
 *
 * Both `setSessionToken` and `clearToSessionOnly` delete the persistent
 * row synchronously (Dexie primary-key `delete("persistent")`), so the
 * "Replace" and "Switch to session-only" actions remove the prior
 * encrypted token record and its associated non-extractable key
 * immediately rather than deferring to the full clear-data action.
 *
 * ## FR-007 single-action wipe
 *
 * The "Clear all" button opens a separate confirmation dialog
 * (`data-testid="clear-all-confirmation"`) that requires an explicit
 * "Confirm clear all" click before the provider's `clearAll` —
 * which spans every Dexie store in a single transaction — runs.
 *
 * ## URL / log / value safety (FR-008)
 *
 * The full plaintext token never appears in any rendered element, in
 * the `useCredentials()` value, in any URL the panel constructs, or in
 * any log the panel emits. The masked identifier (`…abcd`) is the only
 * representation rendered to the user.
 *
 * ## Boundary
 *
 * This module lives under `src/features/credentials/**`. It imports
 * from `src/app/**` (the credentials context the shell mounts) and
 * `src/data/asana/**` (the read-only `testToken` client for the Retest
 * action). It does not import from `src/domain/**` directly — the
 * outcome union's variant surface is consumed inline so the panel does
 * not gain a transitive React/DOM-free dependency on the domain layer.
 */
import {
  useCallback,
  useState,
  type ChangeEvent,
  type ReactElement,
} from "react";

import { useCredentials } from "../../app/credentials-context";
import { testToken } from "../../data/asana/client";
import {
  maskedIdentifierFor,
  summariseUserValidationResult,
  type CredentialValidationSummary,
} from "./helpers";

/**
 * The Settings credentials panel.
 *
 * Composes the four US1 lifecycle actions (Retest, Replace,
 * Switch-mode, Clear-all) over the credentials context. Renders
 * without props — the panel is self-contained, intended to be mounted
 * by a future Settings route (US1 / Phase 3) or inlined in a
 * development / debug page during the credential-flow scaffolding
 * that ships before the route guard (T046) is wired.
 *
 * The component is exported as a named function for parity with the
 * other credential-feature components (TokenEntry, WorkspaceSelector,
 * …) the future tasks in this phase own.
 */
export function SettingsCredentialsPanel(): ReactElement {
  const credentials = useCredentials();

  const [draftToken, setDraftToken] = useState("");
  const [replacementToken, setReplacementToken] = useState("");
  const [currentToken, setCurrentToken] = useState("");
  const [retestOutcome, setRetestOutcome] =
    useState<CredentialValidationSummary | null>(null);
  const [persistentConfirmOpen, setPersistentConfirmOpen] = useState(false);
  const [clearAllConfirmOpen, setClearAllConfirmOpen] = useState(false);

  const onDraftTokenChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      setDraftToken(event.target.value);
    },
    [],
  );
  const onReplacementTokenChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      setReplacementToken(event.target.value);
    },
    [],
  );

  const handleSetToken = useCallback(async (): Promise<void> => {
    const trimmed = draftToken.trim();
    if (trimmed.length === 0) {
      return;
    }
    setCurrentToken(trimmed);
    setRetestOutcome(null);
    // FR-008: clear the typed plaintext from the input so the DOM
    // never echoes the full token (FR-008 invariant — at most a
    // masked suffix may be rendered). The plaintext remains in the
    // panel's local `currentToken` state for the lifetime of the
    // panel (Retest, Replace, Switch-to-persistent all consume it).
    setDraftToken("");
    await credentials.setSessionToken(trimmed, maskedIdentifierFor(trimmed));
  }, [draftToken, credentials]);

  const handleRetest = useCallback(async (): Promise<void> => {
    if (currentToken.length === 0) {
      return;
    }
    const result = await testToken(currentToken);
    setRetestOutcome(summariseUserValidationResult(result));
  }, [currentToken]);

  const handleReplace = useCallback(async (): Promise<void> => {
    const trimmed = replacementToken.trim();
    if (trimmed.length === 0) {
      return;
    }
    setCurrentToken(trimmed);
    setRetestOutcome(null);
    // FR-005a: setSessionToken immediately deletes the prior encrypted
    // record (the provider's primary-key `delete("persistent")` runs
    // before the session-mode state update), so the replace action is
    // also the documented way to remove a stale persistent record
    // when the user wants to keep the new token in memory only.
    await credentials.setSessionToken(trimmed, maskedIdentifierFor(trimmed));
    // FR-008: clear the typed plaintext from the input after the
    // replace so the DOM never echoes the full token — at most the
    // masked suffix remains visible via the credentials context.
    setReplacementToken("");
  }, [replacementToken, credentials]);

  const openPersistentConfirmation = useCallback((): void => {
    setPersistentConfirmOpen(true);
  }, []);

  const handleConfirmPersistent = useCallback(async (): Promise<void> => {
    if (currentToken.length === 0) {
      // The dialog should not be reachable without a current token,
      // but defensively refuse to write an empty plaintext rather
      // than encrypting an empty string (token-crypto rejects
      // empty plaintexts at the validation boundary).
      setPersistentConfirmOpen(false);
      return;
    }
    await credentials.setPersistentToken(
      currentToken,
      maskedIdentifierFor(currentToken),
    );
    setPersistentConfirmOpen(false);
  }, [currentToken, credentials]);

  const handleDeclinePersistent = useCallback((): void => {
    setPersistentConfirmOpen(false);
  }, []);

  const handleSwitchToSession = useCallback(async (): Promise<void> => {
    // FR-005a: clearToSessionOnly deletes the persistent row
    // synchronously (Dexie primary-key `delete("persistent")`); the
    // local plaintext cache is discarded because the user's intent
    // was to drop persistent storage, and the session token is held
    // only in memory by the caller for the lifetime of the panel.
    await credentials.clearToSessionOnly();
    setCurrentToken("");
    setRetestOutcome(null);
  }, [credentials]);

  const openClearAllConfirmation = useCallback((): void => {
    setClearAllConfirmOpen(true);
  }, []);

  const handleConfirmClearAll = useCallback(async (): Promise<void> => {
    // FR-007: the single explicit action that clears the token AND
    // every other Dexie store in one transaction. The provider
    // implementation spans every store so a future contributor who
    // adds a new cache table without updating the wipe list fails
    // CI through the integration test's store-count assertions.
    await credentials.clearAll();
    setCurrentToken("");
    setDraftToken("");
    setReplacementToken("");
    setRetestOutcome(null);
    setClearAllConfirmOpen(false);
  }, [credentials]);

  const handleCancelClearAll = useCallback((): void => {
    setClearAllConfirmOpen(false);
  }, []);

  return (
    <section
      className="td-settings-credentials-panel"
      data-testid="settings-panel"
      aria-label="Settings credentials panel"
    >
      <h2>Credentials</h2>

      <fieldset>
        <legend>Active credential</legend>
        <p>
          Enter your Asana personal access token. The full token is never
          displayed after entry — only a masked identifier (last four
          characters) is shown.
        </p>
        <label>
          <span>Token</span>
          <input
            type="password"
            value={draftToken}
            onChange={onDraftTokenChange}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <button type="button" onClick={handleSetToken}>
          Set token
        </button>
        <button type="button" onClick={handleRetest}>
          Retest
        </button>
        {retestOutcome !== null && (
          <div
            data-testid="retest-outcome"
            role="status"
            aria-live="polite"
            className={`td-settings-credentials-panel__retest td-settings-credentials-panel__retest--${retestOutcome.kind}`}
          >
            {retestOutcome.message}
          </div>
        )}
      </fieldset>

      <fieldset>
        <legend>Replace credential</legend>
        <p>
          Replace the active token with a new one. If persistent storage is
          currently active, the prior encrypted record is deleted immediately
          (FR-005a) and the new token is held in session memory.
        </p>
        <label>
          <span>Replacement credential</span>
          <input
            type="password"
            value={replacementToken}
            onChange={onReplacementTokenChange}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <button type="button" onClick={handleReplace}>
          Replace
        </button>
      </fieldset>

      <fieldset>
        <legend>Storage mode</legend>
        <p>
          Current storage mode: <strong>{credentials.mode ?? "none"}</strong>.
          {credentials.maskedIdentifier.length > 0 && (
            <>
              {" "}
              Active token: <code>…{credentials.maskedIdentifier}</code>.
            </>
          )}
        </p>
        {credentials.mode === "session" && (
          <button type="button" onClick={openPersistentConfirmation}>
            Switch to persistent
          </button>
        )}
        {credentials.mode === "persistent" && (
          <button type="button" onClick={handleSwitchToSession}>
            Switch to session-only
          </button>
        )}

        {persistentConfirmOpen && (
          <div
            className="td-settings-credentials-panel__confirm"
            data-testid="persistent-confirmation"
            role="alertdialog"
            aria-label="Persistent storage confirmation"
            aria-describedby="persistent-confirmation-body"
          >
            <h3>Persist this token</h3>
            <div id="persistent-confirmation-body">
              <p>
                Your Asana personal access token is sensitive. Anyone who
                obtains it can read the workspaces and tasks this token grants
                access to.
              </p>
              <p>
                We will encrypt the token at rest using AES-GCM and store it in
                this browser profile. This protects against opportunistic access
                to the raw browser storage files (such as a copied profile), but
                it does not protect against an attacker who can already execute
                script in this app&apos;s origin.
              </p>
              <p>
                The encrypted token will remain on this device and in this
                browser profile until you clear it from Settings. If you choose
                session-only instead, the token is dropped when this browser
                session ends and you will need to re-enter it next time.
              </p>
            </div>
            <button type="button" onClick={handleConfirmPersistent}>
              Confirm
            </button>
            <button type="button" onClick={handleDeclinePersistent}>
              Decline
            </button>
          </div>
        )}
      </fieldset>

      <fieldset>
        <legend>Clear all data</legend>
        <p>
          Clear the token and every piece of locally retained Asana data (cached
          tasks, snapshots, team mappings, named Person Groups, refresh history,
          workspace selection) in a single action.
        </p>
        <button type="button" onClick={openClearAllConfirmation}>
          Clear all
        </button>

        {clearAllConfirmOpen && (
          <div
            className="td-settings-credentials-panel__confirm"
            data-testid="clear-all-confirmation"
            role="alertdialog"
            aria-label="Clear all data confirmation"
            aria-describedby="clear-all-confirmation-body"
          >
            <h3>Clear all locally retained Asana data?</h3>
            <div id="clear-all-confirmation-body">
              <p>
                This will wipe the encrypted token, every cached task, snapshot,
                team-mapping override, named Person Group, refresh history, and
                workspace selection from this browser profile.
              </p>
              <p>
                The action cannot be undone. You will need to re-enter your
                token and run a fresh refresh to repopulate the dashboard.
              </p>
            </div>
            <button type="button" onClick={handleConfirmClearAll}>
              Confirm clear all
            </button>
            <button type="button" onClick={handleCancelClearAll}>
              Cancel
            </button>
          </div>
        )}
      </fieldset>
    </section>
  );
}
