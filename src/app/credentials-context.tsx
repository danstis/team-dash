/**
 * T031 — `CredentialsProvider`, the top-level shell context for the
 * current Asana personal access token.
 *
 * The shell is the first thing every feature imports across (T031 is
 * the last Phase 2 task — every downstream feature assumes the shell
 * provider tree exists). This module owns the credential half of that
 * tree: which token the user has entered, in what storage mode, and
 * the derived `ViewState` the rest of the app uses to decide what to
 * render.
 *
 * ## Why a context, not a hook
 *
 * The router (T046) needs the credential state to decide whether to
 * render the first-run flow or the reporting screens. A hook would
 * couple the router to whichever feature happens to call it first; a
 * context lets the router mount above the feature boundary and ask a
 * single question (`useCredentials().state`) that composes across every
 * provider.
 *
 * ## Why we do not block render on the decrypt
 *
 * The Constitution (Principle IV) and spec FR-002a together say:
 *
 *   "…MUST decrypt it automatically on launch without requiring a
 *   separate unlock step…"
 *
 * A provider that suspends its children behind the AES-GCM decrypt
 * would either (a) hide the app shell for the duration of the decrypt
 * or (b) require an extra "loading…" overlay that does not exist in
 * the spec. Instead we render children immediately with `state =
 * 'loading'`, run the decrypt on `useEffect`, and let downstream
 * features render an honest `'loading'` surface until the state
 * resolves.
 *
 * ## What we deliberately do not own
 *
 * - The masked-token display component is owned by T044
 *   (`MaskedToken`); this provider stores the masked identifier the
 *   encryption layer produced alongside the encrypted record. FR-008
 *   means we never surface the full token through the context at all —
 *   the masked identifier (`…abcd`) is the only representation
 *   downstream UI renders. The credential lifecycle actions
 *   (`setSessionToken`, `setPersistentToken`, `clearToSessionOnly`,
 *   `clearAll`) own the FR-002a / FR-005a / FR-007 IndexedDB write
 *   paths so the Settings panel (T045) can compose them without
 *   having to depend on a separate `CredentialRepository` module —
 *   the credential repository's contract from
 *   `contracts/storage-repository.md` is satisfied inline here.
 *
 * ## URL/log safety
 *
 * `setSessionToken` / `setPersistentToken` take a `string` parameter
 * and never echo that string into another field, log, or telemetry
 * path. A test in this module (`does not expose the plaintext token
 * via useCredentials`) pins the boundary so a future contributor who
 * accidentally widens the context cannot ship the leak.
 *
 * ## Boundary
 *
 * This module lives under `src/app/**`. It imports from
 * `src/data/**` (the Dexie schema and the token-crypto module) and
 * from `src/domain/**` only for type imports (`ViewState`). It does
 * not import from `src/features/**` — the shell mounts features,
 * not the other way around, so a feature dependency here would
 * invert the dependency direction.
 *
 * The `eslint-plugin-boundaries` configuration in `eslint.config.js`
 * currently constrains `src/domain/**` only (Constitution Principle
 * VI's lint-enforced half of the boundary); the "no feature import
 * from app" rule is enforced by architectural convention and code
 * review, not by lint. A future contributor may choose to tighten
 * the rule by adding a `boundaries/dependencies` policy on
 * `src/app/**` so this convention becomes lint-enforced too.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { db } from "../data/db/schema";
import {
  decryptToken,
  encryptToken,
  generateTokenKey,
  isTokenCryptoError,
} from "../data/crypto/token-crypto";
import type { ViewState } from "../domain/types";

/**
 * The full Dexie table list that FR-007's single-transaction wipe must
 * span. Mirrors `contracts/storage-repository.md` and the Dexie schema
 * in `src/data/db/schema.ts` — kept here as a local constant rather than
 * derived from the schema class so the boundary is explicit at the
 * credential repository's call site (a future schema addition that
 * forgets to update this list fails CI through the
 * `tests/integration/credentials/settings-panel.test.tsx` clear-all
 * assertion, which counts every store after `clearAll()`).
 */
const ALL_DATA_TABLE_NAMES = [
  "workspaces",
  "projects",
  "portfolios",
  "asanaTeams",
  "teamMappingOverrides",
  "personGroups",
  "users",
  "priorityFields",
  "dependencies",
  "sections",
  "tasks",
  "snapshots",
  "refreshSessions",
  "credentials",
] as const;

/**
 * The credential storage mode surfaced to the rest of the app.
 * Mirrors the `mode` discriminant on `CredentialRecord` in
 * `src/data/db/schema.ts` (T021 / data-model.md) — kept as a local
 * type alias rather than re-importing the schema interface so this
 * module has no compile-time dependency on the Dexie row shape.
 */
export type CredentialsMode = "session" | "persistent" | null;

/**
 * The current credential the shell is holding. `token` is the
 * plaintext PAT for the lifetime of the call it backs; the provider
 * never logs it and never echoes it through a context field whose
 * name could be picked up by a React DevTools consumer (FR-008).
 *
 * `maskedIdentifier` is the only representation the rest of the app
 * is permitted to render — produced alongside the encrypted record by
 * the future `CredentialRepository` and surfaced here for downstream
 * UI (T044's `MaskedToken`).
 */
export interface CredentialsSnapshot {
  mode: Exclude<CredentialsMode, null>;
  maskedIdentifier: string;
}

/**
 * The provider's public surface. The four action methods are
 * `async` even when their bodies are synchronous today — a future
 * `CredentialRepository` call is awaited inside, and the router/UI
 * consumers (T043's workspace selector, T045's settings panel) need
 * the promise to await the Dexie write before navigating.
 */
export interface CredentialsContextValue {
  /**
   * The current `ViewState`. `'loading'` on the first synchronous
   * render, then resolves to `'first_run'`, `'ready'`, or one of the
   * failure states on the next render.
   */
  state: ViewState;
  /** The current mode once known — `null` until the IndexedDB lookup resolves. */
  mode: CredentialsMode;
  /** The masked identifier once known — empty until the IndexedDB lookup resolves. */
  maskedIdentifier: string;
  /** Hold the plaintext token in memory only (no Dexie write). */
  setSessionToken: (token: string, maskedIdentifier: string) => Promise<void>;
  /** Encrypt + persist the token (FR-002a); deletes any prior persistent record first (FR-005a). */
  setPersistentToken: (
    token: string,
    maskedIdentifier: string,
  ) => Promise<void>;
  /** Delete the persistent record; keep the token in memory only. */
  clearToSessionOnly: () => Promise<void>;
  /** FR-007: single-action wipe of credentials + all locally retained Asana data. */
  clearAll: () => Promise<void>;
}

const CREDENTIALS_CONTEXT_DEFAULT: CredentialsContextValue = {
  state: "loading",
  mode: null,
  maskedIdentifier: "",
  setSessionToken: async () => {
    throw new Error(
      "CredentialsProvider.setSessionToken called outside a provider",
    );
  },
  setPersistentToken: async () => {
    throw new Error(
      "CredentialsProvider.setPersistentToken called outside a provider",
    );
  },
  clearToSessionOnly: async () => {
    throw new Error(
      "CredentialsProvider.clearToSessionOnly called outside a provider",
    );
  },
  clearAll: async () => {
    throw new Error("CredentialsProvider.clearAll called outside a provider");
  },
};

const CredentialsContext = createContext<CredentialsContextValue>(
  CREDENTIALS_CONTEXT_DEFAULT,
);

CredentialsContext.displayName = "CredentialsContext";

/**
 * Read the current credential state. Throws if called outside the
 * provider so a feature component that forgets to wrap with
 * `<CredentialsProvider>` fails fast at the call site rather than
 * silently rendering with the default `'loading'` state.
 */
export function useCredentials(): CredentialsContextValue {
  const value = useContext(CredentialsContext);
  // The default value is the only way `value` can come from outside a
  // real provider — distinguishing the two cases lets the error
  // message point a developer at the right place.
  if (value === CREDENTIALS_CONTEXT_DEFAULT) {
    throw new Error(
      "useCredentials must be called inside <CredentialsProvider>",
    );
  }
  return value;
}

export interface CredentialsProviderProps {
  children: ReactNode;
}

/**
 * Mount the credentials context. Renders its children on the first
 * synchronous render with `state = 'loading'`; runs the IndexedDB
 * lookup + AES-GCM decrypt on `useEffect`; resolves to one of the
 * documented `ViewState` values (`'first_run'`, `'ready'`, …) on the
 * next render.
 */
export function CredentialsProvider({
  children,
}: CredentialsProviderProps): ReactNode {
  const [state, setState] = useState<ViewState>("loading");
  const [mode, setMode] = useState<CredentialsMode>(null);
  const [maskedIdentifier, setMaskedIdentifier] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    void (async (): Promise<void> => {
      const stored = await db.credentials.get("persistent");
      if (cancelled) {
        return;
      }
      if (stored === undefined) {
        setState("first_run");
        return;
      }

      // T031 only handles the persistent record. A session-only token
      // (FR-002 "default mode") is held in memory only and therefore
      // never appears in IndexedDB; the loader below reflects that
      // distinction by treating "no persistent row" as `first_run`.
      try {
        const plaintext = await decryptToken(
          stored.encryptedTokenRecord.ciphertext,
          stored.encryptedTokenRecord.iv,
          stored.encryptedTokenRecord.keyRef,
        );
        if (cancelled) {
          return;
        }
        // The plaintext token never crosses the context boundary
        // (FR-008) — we read it solely so a subsequent token-backing
        // Asana call has it on hand. Today the only consumer is the
        // route guard T046; future US1/US2 features read it via the
        // narrower per-call API the future CredentialRepository will
        // expose.
        void plaintext;
        setMode("persistent");
        setMaskedIdentifier(stored.maskedIdentifier);
        setState("ready");
      } catch (error) {
        // FR-002b: a missing or corrupted non-extractable key, or a
        // tampered ciphertext, MUST transition the app to the first-
        // run credential entry screen rather than a dedicated error
        // state. We also delete the corrupt row so a subsequent
        // attempt can write a fresh record without colliding with a
        // stale one.
        if (isTokenCryptoError(error)) {
          await db.credentials.delete("persistent").catch(() => {
            // Best-effort cleanup; the next write path (T040) is the
            // canonical owner of this row's lifecycle.
          });
        }
        if (cancelled) {
          return;
        }
        setMode(null);
        setMaskedIdentifier("");
        setState("first_run");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setSessionToken = useCallback(
    async (_token: string, nextMaskedIdentifier: string): Promise<void> => {
      // FR-005a: switching from persistent mode back to session-only —
      // or replacing a stored token with a session-only one — MUST
      // immediately delete the previous encrypted token record and
      // its associated non-extractable key from IndexedDB, not wait
      // for the full FR-007 clear-data action. Dexie's primary-key
      // upsert on the `credentials` table guarantees there is at most
      // one persistent row, so `delete("persistent")` is sufficient.
      await db.credentials.delete("persistent");
      // FR-008: the plaintext token value is intentionally not echoed
      // back anywhere in this provider's state — only the masked
      // identifier. The caller (e.g. the Settings credentials panel,
      // T045) is the canonical owner of the in-memory token lifetime
      // and decides when to forget it.
      setMode("session");
      setMaskedIdentifier(nextMaskedIdentifier);
      setState("ready");
    },
    [],
  );

  const setPersistentToken = useCallback(
    async (token: string, nextMaskedIdentifier: string): Promise<void> => {
      // FR-002a: encrypt the token under a freshly-generated
      // non-extractable AES-GCM key (T027, `data/crypto/token-crypto`)
      // and persist the encrypted record + key handle in IndexedDB.
      // The key is non-extractable by design (Constitution Principle
      // IV) so the raw key material cannot be copied out of the
      // SubtleCrypto handle by reading the browser's storage files.
      const key = await generateTokenKey();
      const { ciphertext, iv } = await encryptToken(token, key);
      await db.credentials.put({
        mode: "persistent",
        encryptedTokenRecord: { ciphertext, iv, keyRef: key },
        maskedIdentifier: nextMaskedIdentifier,
        lastValidatedAt: null,
        lastValidationResult: null,
      });

      // FR-005a: replacing a prior persistent token or switching out
      // of session mode into persistent MUST delete the previous
      // encrypted token record. Dexie's primary-key upsert on
      // `credentials` (the singleton `mode: "persistent"` row)
      // already discards the prior row's ciphertext and key, so no
      // explicit pre-delete is required here.

      // FR-008: the plaintext token value never crosses the context
      // boundary. The caller (Settings panel) keeps the in-memory
      // token for the duration of the panel's lifetime and discards
      // it on unmount / clear-all.
      setMode("persistent");
      setMaskedIdentifier(nextMaskedIdentifier);
      setState("ready");
    },
    [],
  );

  const clearToSessionOnly = useCallback(async (): Promise<void> => {
    // FR-005a: switching from persistent mode back to session-only
    // MUST immediately delete the previous encrypted token record
    // and its associated non-extractable key. The Dexie primary-key
    // `delete("persistent")` is sufficient because the credentials
    // table only ever holds the singleton persistent row keyed by
    // `mode`.
    await db.credentials.delete("persistent");
    setMode("session");
    setMaskedIdentifier("");
    setState("ready");
  }, []);

  const clearAll = useCallback(async (): Promise<void> => {
    // FR-007: the single explicit action that clears the token AND
    // all locally retained Asana data (cache, snapshots, team
    // mapping overrides, named person groups, refresh sessions,
    // workspaces selection, …) MUST be a single Dexie transaction
    // spanning every store. A partial clear — token wiped but cache
    // retained, or vice versa — is the contract violation this
    // transaction prevents. Dexie's native transaction atomicity
    // (Principle V) is the enforcement mechanism: the writes either
    // all land or none do.
    await db.transaction("rw", [...ALL_DATA_TABLE_NAMES], async () => {
      for (const tableName of ALL_DATA_TABLE_NAMES) {
        await db.table(tableName).clear();
      }
    });
    setMode(null);
    setMaskedIdentifier("");
    setState("first_run");
  }, []);

  const value = useMemo<CredentialsContextValue>(
    () => ({
      state,
      mode,
      maskedIdentifier,
      setSessionToken,
      setPersistentToken,
      clearToSessionOnly,
      clearAll,
    }),
    [
      state,
      mode,
      maskedIdentifier,
      setSessionToken,
      setPersistentToken,
      clearToSessionOnly,
      clearAll,
    ],
  );

  return (
    <CredentialsContext.Provider value={value}>
      {children}
    </CredentialsContext.Provider>
  );
}
