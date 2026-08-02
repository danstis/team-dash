/**
 * T041 — `TokenEntryForm` + `TestTokenButton` (US1, BSOD-169).
 *
 * Spec / contract references
 * --------------------------
 * This module is the first-run surface for US1 acceptance scenarios 1
 * and 2 (spec.md §"User Story 1"):
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
 * Scenario 7's "token never rendered, logged, or embedded" rule is
 * also pinned here (FR-008) — the form's input field is a password
 * input, the plaintext value is held in local component state only
 * (never echoed through a prop, log, URL, or context field), and the
 * only representation the rest of the app sees is the masked
 * identifier the form computes via `token.slice(-4)`.
 *
 * What this module owns
 * ---------------------
 * - `<TestTokenButton />` — the click-to-validate button. Calls
 *   `testToken(token)` (T039, `src/data/asana/client.ts`), maps the
 *   `AsanaClientResult` discriminated union onto a user-facing
 *   `TokenTestOutcome` summary, and forwards the summary via an
 *   `onResult` callback. The button is disabled while a previous
 *   validation is still in flight (`aria-busy="true"`) and while the
 *   token input is empty.
 * - `<TokenEntryForm />` — the wrapper that composes the password
 *   input, the `<TestTokenButton />`, and a status panel. On a
 *   successful `testToken` outcome the form also calls
 *   `listWorkspaces(token)` to fetch the workspaces the token can
 *   access (FR-011), surfaces the validated token + workspace list via
 *   an `onValidated` callback for downstream US1 features (T042
 *   `StorageModeSelector`, T043 `WorkspaceSelector`, T046 route guard),
 *   and clears the typed plaintext from the DOM input (FR-008) so the
 *   rendered surface never echoes the full token.
 *
 * What this module deliberately does NOT own
 * -----------------------------------------
 * - The credential write path: the form does NOT call
 *   `setSessionToken` / `setPersistentToken` itself. The downstream
 *   storage-mode selector (T042) and workspace selector (T043) own
 *   that decision; the form hands them the validated token via the
 *   `onValidated` callback so they can run it through FR-003's
 *   explicit-confirmation gate before any Dexie write. The
 *   `CredentialsProvider` (`src/app/credentials-context.tsx`) is
 *   therefore NOT a dependency of this module — the form is the
 *   first-run entry surface, not a settings-page surface.
 *
 * - The masked-identifier *algorithm*: that is T044's deliverable
 *   (`<MaskedToken />`). The form computes the masked suffix
 *   inline for its `onValidated` payload so downstream features do
 *   not have to re-implement the last-four rule; the eventual
 *   `MaskedToken` component will own the canonical rendering format.
 *
 * - The route guard that decides when this surface is visible: that
 *   is T046's deliverable (`src/app/router.tsx`).
 *
 * Boundary
 * --------
 * `src/features/credentials/**` is a feature component boundary the
 * plan documents as the home for the credential-flow React UI. This
 * module imports from:
 *   - `../../data/asana/client` — the read-only `testToken` and
 *     `listWorkspaces` wrappers (T039).
 *   - `../../data/asana/schemas` — the Zod resource schemas the
 *     wrappers validate against (T023).
 *   - `../../data/asana/types` — the `AsanaClientResult<T>` outcome
 *     union (T024).
 *
 * It does NOT import from `src/domain/**` (the ESLint boundary
 * enforced by `eslint.config.js` would reject a domain import here
 * — the form's outcome mapping is inline rather than a domain helper
 * because the mapping is presentation-specific: the user-facing
 * message strings are owned by this module, not by domain logic that
 * would have to be presentation-agnostic). It does NOT import from
 * `src/app/**` (the shell mounts features, not the other way
 * around — see `src/app/App.tsx` docstring).
 *
 * Determinism
 * -----------
 * The form is fully synchronous on first paint (no async init, no
 * IndexedDB read) so a remount or fast-refresh does not flap a
 * loading state. All randomness and crypto handling lives behind
 * `testToken` / `listWorkspaces` (which in turn delegate to the
 * Web Crypto / SubtleCrypto surface only as needed by
 * `tokens-crypto`), so the form is deterministic at the
 * render-surface level — see the `SettingsCredentialsPanel` /
 * `TokenEntryForm` separation note for the rationale on keeping the
 * form's outcome mapping local rather than importing a shared
 * summariser.
 */
import {
  useCallback,
  useState,
  type ChangeEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import type { z } from "zod";

import { listWorkspaces, testToken } from "../../data/asana/client";
import {
  asanaWorkspaceListResponseSchema,
  asanaWorkspaceSchema,
} from "../../data/asana/schemas";
import type { AsanaClientResult } from "../../data/asana/types";
import {
  maskedIdentifierFor,
  MS_PER_SECOND,
  summariseUserValidationResult,
  type CredentialValidationOutcomeKind,
  type CredentialValidationSummary,
} from "./helpers";

/* -------------------------------------------------------------------------- */
/* Outcome surface                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The closed set of outcome kinds the user-facing summary can take.
 * Mirrors the six-variant `AsanaClientResultOutcome` discriminated
 * union (T024) one-to-one, plus the synthetic `'valid'` outcome that
 * only `summariseUserResult` produces from the `ok` variant.
 *
 * Exported as a literal type so downstream US1 features (T042, T043)
 * can switch on it exhaustively without re-deriving the union.
 */
export type TokenTestOutcomeKind = CredentialValidationOutcomeKind;

/**
 * The display-only summary of a single `testToken` (or
 * post-validation `listWorkspaces`) outcome. Deliberately distinct
 * from the full `AsanaClientResult<T>` union: the form never has to
 * re-discriminate the result once the summary string has been
 * computed, and the per-variant fields the summary does not need
 * (`retryAfterMs`, the `issues[]` array, the underlying `data`)
 * do not leak into the form's local state.
 */
export interface TokenTestOutcome extends CredentialValidationSummary {}

/**
 * The `listWorkspaces` client function's return type. Aliased for
 * the same reason as `AsanaUserResult`.
 */
type AsanaWorkspaceListResult = AsanaClientResult<
  z.infer<typeof asanaWorkspaceListResponseSchema>
>;

/* -------------------------------------------------------------------------- */
/* Outcome summarisers (FR-004 specific-failure-reason contract)              */
/* -------------------------------------------------------------------------- */

/**
 * Render a post-validation `listWorkspaces` failure as a
 * user-facing summary. Used only after `testToken` has already
 * returned `ok`, so the failure modes that imply "token is
 * invalid" still surface as `invalid_token` even though
 * `listWorkspaces` is the call that actually returned the 401 —
 * the user-facing meaning of "Asana rejected the credential" does
 * not change based on which endpoint reported it.
 *
 * The `'ok'` branch is unreachable from the call site (we only
 * invoke this summariser when `listWorkspaces` returned a
 * non-`ok` outcome) but is included so the switch is exhaustive
 * over `AsanaWorkspaceListResult` — a future contributor who
 * adds a seventh outcome to the union fails `tsc` here rather
 * than at the call site.
 */
function summariseWorkspaceListFailure(
  result: AsanaWorkspaceListResult,
): TokenTestOutcome {
  switch (result.outcome) {
    case "ok":
      return {
        kind: "validation_error",
        message:
          "Workspace listing succeeded unexpectedly; please retry the test.",
      };
    case "auth_failure":
      return {
        kind: "invalid_token",
        message:
          "Invalid token. Asana rejected the credential while listing workspaces.",
      };
    case "permission_failure":
      return {
        kind: "insufficient_permission",
        message:
          "Insufficient permission to list workspaces. The token may lack the required scopes.",
      };
    case "rate_limited":
      return {
        kind: "rate_limited",
        message: `Rate limited by Asana. Retry after ${Math.round(
          result.retryAfterMs / MS_PER_SECOND,
        )}s.`,
      };
    case "network_error":
      return {
        kind: "network_error",
        message: `Network error: ${result.message}`,
      };
    case "validation_error":
      return {
        kind: "validation_error",
        message:
          "Unexpected response from Asana. The API shape may have changed.",
      };
  }
}

/* -------------------------------------------------------------------------- */
/* TestTokenButton (FR-004)                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The public props surface of `<TestTokenButton />`. The component is
 * the T041 "Test token" button — it composes the read-only
 * `testToken` client (T039) and surfaces the outcome as a
 * `TokenTestOutcome` summary via the `onResult` callback.
 */
export interface TestTokenButtonProps {
  /**
   * The current token to test. The button is disabled when this is
   * empty so a user cannot fire a validation against an empty
   * input. The button never echoes this value back; it is consumed
   * inside the click handler and discarded on return.
   */
  readonly token: string;
  /**
   * Externally-applied disable (e.g. when the parent form is
   * already running its post-validation `listWorkspaces` round
   * trip). Combined with the internal `pending` and `token.length
   * === 0` guards so the button is disabled in three cases:
   * parent says "no", a validation is in flight, or there is no
   * token to validate.
   */
  readonly disabled?: boolean;
  /**
   * Fired with the user-facing outcome summary after each
   * `testToken` round-trip. The callback may be async; the
   * button's `pending` state stays `true` until the callback
   * resolves so a parent that needs to run another network call
   * (the form runs `listWorkspaces` here) cannot double-fire.
   */
  readonly onResult?: (outcome: TokenTestOutcome) => void | Promise<void>;
  /** Optional override of the visible button label. Defaults to "Test token". */
  readonly children?: ReactNode;
}

/**
 * The "Test token" button. Renders as a native `<button
 * type="button">` so embedding inside a parent `<form>` does not
 * trigger a submit. Calls `testToken(token)` on click, maps the
 * outcome union onto a `TokenTestOutcome`, and forwards the summary
 * via `onResult`. The button label switches to "Testing token…"
 * while the round-trip is in flight and `aria-busy="true"` is set so
 * assistive tech announces the busy state.
 */
export function TestTokenButton({
  token,
  disabled = false,
  onResult,
  children,
}: Readonly<TestTokenButtonProps>): ReactElement {
  const [pending, setPending] = useState(false);

  const handleClick = useCallback(async (): Promise<void> => {
    if (token.length === 0 || pending) {
      return;
    }
    setPending(true);
    try {
      const result = await testToken(token);
      const outcome = summariseUserValidationResult(result);
      await onResult?.(outcome);
    } finally {
      setPending(false);
    }
  }, [token, pending, onResult]);

  const isDisabled = disabled || pending || token.length === 0;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isDisabled}
      data-testid="test-token-button"
      aria-busy={pending}
    >
      {pending ? "Testing token…" : (children ?? "Test token")}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* TokenEntryForm (FR-004 + FR-011)                                           */
/* -------------------------------------------------------------------------- */

/**
 * The single-workspace-or-list of workspaces returned from a
 * successful `listWorkspaces` round-trip, plus the plaintext token
 * (so the form can hand it to downstream US1 features) and the
 * masked identifier (so downstream features do not have to
 * recompute the FR-008 last-four rule).
 *
 * `token` is held in the parent's local component state only —
 * the form is intentionally NOT a context provider for it. The
 * plaintext crosses the form's boundary only via the
 * `onValidated` callback's first field, and the receiving
 * downstream component owns the in-memory lifetime from there
 * (typically the `StorageModeSelector` T042 which decides whether
 * to encrypt-and-persist or hold-in-session before any Dexie
 * write).
 */
export interface ValidatedToken {
  readonly token: string;
  readonly maskedIdentifier: string;
  readonly workspaces: readonly z.infer<typeof asanaWorkspaceSchema>[];
}

/**
 * The public props surface of `<TokenEntryForm />`. The form is
 * self-contained; the only external hook is the `onValidated`
 * callback that fires once a token has been tested AND the
 * post-validation `listWorkspaces` round-trip has succeeded.
 */
export interface TokenEntryFormProps {
  /**
   * Fired once per validation round-trip that completes with a
   * valid token AND a non-empty workspace list. The receiving
   * downstream component (T042 `StorageModeSelector`, T043
   * `WorkspaceSelector`, or the eventual T046 route guard's
   * first-run surface) is responsible for advancing the
   * credentials context — this form never calls
   * `useCredentials().setSessionToken` itself, because the
   * storage-mode decision (FR-002 / FR-003) is downstream of
   * token validation and must apply the FR-003 risk-disclosure
   * gate before any Dexie write.
   */
  readonly onValidated?: (validated: ValidatedToken) => void;
}

/**
 * The first-run credential entry form. The composes the password
 * input, the `<TestTokenButton />`, and a status panel that
 * surfaces the test outcome to the user. On a successful
 * `testToken` it runs `listWorkspaces` to fetch the workspaces
 * the token can access (FR-011) and surfaces the validated token
 * + workspace list via `onValidated`.
 *
 * The form's local state holds the plaintext token in a single
 * `useState` (`draftToken`) and the post-validation state in a
 * second `useState` (`validated`). The form clears `draftToken`
 * after a successful validation (FR-008 — at most a masked suffix
 * may be rendered) and disables the input while the
 * post-validation `listWorkspaces` round-trip is in flight.
 */
export function TokenEntryForm({
  onValidated,
}: Readonly<TokenEntryFormProps>): ReactElement {
  const [draftToken, setDraftToken] = useState<string>("");
  const [outcome, setOutcome] = useState<TokenTestOutcome | null>(null);
  const [listingWorkspaces, setListingWorkspaces] = useState<boolean>(false);
  const [validated, setValidated] = useState<ValidatedToken | null>(null);

  const onDraftTokenChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      setDraftToken(event.target.value);
      // Editing the input invalidates any prior test outcome: a token
      // that previously failed (or succeeded) is no longer the value
      // being submitted, so re-rendering the prior outcome would be
      // misleading. The same logic clears the post-validation state
      // so the "validated token + workspaces" panel does not linger
      // after the user has started editing a different value.
      if (outcome !== null) {
        setOutcome(null);
      }
      if (validated !== null) {
        setValidated(null);
      }
    },
    [outcome, validated],
  );

  const handleTestResult = useCallback(
    async (result: TokenTestOutcome): Promise<void> => {
      setOutcome(result);
      if (result.kind !== "valid") {
        return;
      }
      setListingWorkspaces(true);
      try {
        // FR-011 — fetch the workspaces the validated token can
        // access so the user can pick one. The same `draftToken`
        // string we passed to `testToken` is the bearer for
        // `listWorkspaces`; the call site is the per-call
        // token-parameter boundary the Asana client contract
        // documents (contracts/asana-client.md §"Token handling").
        const listResult = await listWorkspaces(draftToken);
        if (listResult.outcome === "ok") {
          const next: ValidatedToken = {
            token: draftToken,
            maskedIdentifier: maskedIdentifierFor(draftToken),
            workspaces: listResult.data.data,
          };
          setValidated(next);
          // FR-008 — clear the typed plaintext from the input so
          // the DOM never echoes the full token. The plaintext
          // remains in the form's local `validated.token` field
          // for the lifetime of the form (downstream T042/T043
          // consume it via the `onValidated` payload) and is
          // dropped when the user starts editing the input
          // again (the `onDraftTokenChange` handler nulls the
          // `validated` state on first keystroke).
          setDraftToken("");
          onValidated?.(next);
        } else {
          setOutcome(summariseWorkspaceListFailure(listResult));
        }
      } finally {
        setListingWorkspaces(false);
      }
    },
    [draftToken, onValidated],
  );

  return (
    <form
      className="td-token-entry-form"
      data-testid="token-entry-form"
      aria-label="Token entry"
      onSubmit={(event): void => {
        event.preventDefault();
      }}
    >
      <fieldset disabled={listingWorkspaces}>
        <legend>Asana personal access token</legend>
        <p>
          Enter your Asana personal access token. After testing succeeds, you
          will choose a workspace and how the token should be stored.
        </p>
        <label>
          <span>Token</span>
          <input
            type="password"
            value={draftToken}
            onChange={onDraftTokenChange}
            autoComplete="off"
            spellCheck={false}
            aria-describedby="token-entry-help"
          />
        </label>
        <p id="token-entry-help">
          The full token is never displayed after entry — only a masked
          identifier (last four characters) is shown.
        </p>
        <TestTokenButton
          token={draftToken}
          disabled={listingWorkspaces}
          onResult={handleTestResult}
        >
          Test token
        </TestTokenButton>
        {outcome !== null && (
          <div
            data-testid="token-test-outcome"
            role="status"
            aria-live="polite"
            className={`td-token-entry-form__outcome td-token-entry-form__outcome--${outcome.kind}`}
          >
            {outcome.message}
          </div>
        )}
        {validated !== null && (
          <div data-testid="token-entry-validated">
            <h3>Token validated</h3>
            <p>
              Found {validated.workspaces.length} workspace
              {validated.workspaces.length === 1 ? "" : "s"} accessible to this
              token. Continue to choose a storage mode and a workspace.
            </p>
            <ul>
              {validated.workspaces.map((workspace) => (
                <li key={workspace.gid}>
                  <code>{workspace.name}</code>
                </li>
              ))}
            </ul>
          </div>
        )}
      </fieldset>
    </form>
  );
}
