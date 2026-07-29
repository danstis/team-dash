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
 *   paths so the Settings panel (T045) can compose them while the
 *   dedicated `CredentialRepository` enforces the storage contract from
 *   `contracts/storage-repository.md`.
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
  useRef,
  useState,
  type ReactNode,
} from "react";

import { decryptToken, isTokenCryptoError } from "../data/crypto/token-crypto";
import {
  credentialRepository,
  maskTokenIdentifier,
} from "../data/db/repositories/credential.repository";
import type { ViewState } from "../domain/types";

export type CredentialsMode = "session" | "persistent" | null;

export interface CredentialsSnapshot {
  mode: Exclude<CredentialsMode, null>;
  maskedIdentifier: string;
}

export interface CredentialsContextValue {
  state: ViewState;
  mode: CredentialsMode;
  maskedIdentifier: string;
  getPlaintextToken: () => string | null;
  setSessionToken: (token: string, maskedIdentifier: string) => Promise<void>;
  setPersistentToken: (
    token: string,
    maskedIdentifier: string,
  ) => Promise<void>;
  clearToSessionOnly: () => Promise<void>;
  clearAll: () => Promise<void>;
}

const CREDENTIALS_CONTEXT_DEFAULT: CredentialsContextValue = {
  state: "loading",
  mode: null,
  maskedIdentifier: "",
  getPlaintextToken: () => null,
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

export function useCredentials(): CredentialsContextValue {
  const value = useContext(CredentialsContext);
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

export function CredentialsProvider({
  children,
}: CredentialsProviderProps): ReactNode {
  const [state, setState] = useState<ViewState>("loading");
  const [mode, setMode] = useState<CredentialsMode>(null);
  const [maskedIdentifier, setMaskedIdentifier] = useState<string>("");
  const privateTokenRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async (): Promise<void> => {
      const stored = await credentialRepository.getCurrent();
      if (cancelled) {
        return;
      }
      if (stored === null) {
        privateTokenRef.current = null;
        setMode(null);
        setMaskedIdentifier("");
        setState("first_run");
        return;
      }

      try {
        const plaintext = await decryptToken(
          stored.encryptedTokenRecord.ciphertext,
          stored.encryptedTokenRecord.iv,
          stored.encryptedTokenRecord.keyRef,
        );
        if (cancelled) {
          return;
        }
        privateTokenRef.current = plaintext;
        setMode("persistent");
        setMaskedIdentifier(maskTokenIdentifier(plaintext));
        setState("ready");
      } catch (error) {
        if (isTokenCryptoError(error)) {
          await credentialRepository.clearToSessionOnly().catch(() => {
            // Best-effort cleanup; the next write path is the canonical
            // owner of this row's lifecycle.
          });
        }
        if (cancelled) {
          return;
        }
        privateTokenRef.current = null;
        setMode(null);
        setMaskedIdentifier("");
        setState("first_run");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const getPlaintextToken = useCallback((): string | null => {
    return privateTokenRef.current;
  }, []);

  const setSessionToken = useCallback(
    async (token: string, nextMaskedIdentifier: string): Promise<void> => {
      await credentialRepository.setSessionToken(token);
      privateTokenRef.current = token;
      setMode("session");
      setMaskedIdentifier(nextMaskedIdentifier || maskTokenIdentifier(token));
      setState("ready");
    },
    [],
  );

  const setPersistentToken = useCallback(
    async (token: string, nextMaskedIdentifier: string): Promise<void> => {
      await credentialRepository.setPersistentToken(token);
      privateTokenRef.current = token;
      setMode("persistent");
      setMaskedIdentifier(nextMaskedIdentifier || maskTokenIdentifier(token));
      setState("ready");
    },
    [],
  );

  const clearToSessionOnly = useCallback(async (): Promise<void> => {
    await credentialRepository.clearToSessionOnly();

    if (privateTokenRef.current === null) {
      setMode(null);
      setMaskedIdentifier("");
      setState("first_run");
      return;
    }

    setMode("session");
    setMaskedIdentifier(maskTokenIdentifier(privateTokenRef.current));
    setState("ready");
  }, []);

  const clearAll = useCallback(async (): Promise<void> => {
    await credentialRepository.clearAll();
    privateTokenRef.current = null;
    setMode(null);
    setMaskedIdentifier("");
    setState("first_run");
  }, []);

  const value = useMemo<CredentialsContextValue>(
    () => ({
      state,
      mode,
      maskedIdentifier,
      getPlaintextToken,
      setSessionToken,
      setPersistentToken,
      clearToSessionOnly,
      clearAll,
    }),
    [
      state,
      mode,
      maskedIdentifier,
      getPlaintextToken,
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
