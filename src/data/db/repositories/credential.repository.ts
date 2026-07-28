/**
 * T040 — `CredentialRepository` (US1, BSOD-168).
 *
 * Implements the `CredentialRepository` interface declared in
 * `specs/001-asana-team-dashboard/contracts/storage-repository.md`. This
 * module is the only writer to the `credentials` Dexie store (Constitution
 * Principle VI: explicit architecture — every storage side-effect goes
 * through a repository, never a feature component or the React provider
 * tree). The `CredentialsProvider` in `src/app/credentials-context.tsx`
 * delegates to this repository for the five lifecycle actions; the
 * Settings credentials panel (T045) reaches the same surface through the
 * provider.
 *
 * Contract reference (verbatim from `contracts/storage-repository.md`):
 *
 * ```
 * interface CredentialRepository {
 *   getCurrent(): Promise<CredentialRecord | null>;
 *   setSessionToken(token: string): Promise<void>;         // memory only, no Dexie write
 *   setPersistentToken(token: string): Promise<void>;       // encrypts via data/crypto, deletes any prior encrypted record first (FR-005a)
 *   clearToSessionOnly(): Promise<void>;                     // deletes encrypted record + key, keeps token in memory only
 *   clearAll(): Promise<void>;                                // FR-007: deletes credentials AND cache AND snapshots AND team mappings AND named person groups, in one transaction
 * }
 * ```
 *
 * Hard constraints (cross-cuts the contract):
 *
 * 1. **FR-005a**: `setPersistentToken` and `setSessionToken` MUST
 *    immediately delete the prior encrypted token record and its
 *    non-extractable `CryptoKey` from IndexedDB before the new state is
 *    considered established. A deferred or staged delete is the contract
 *    failure these tests pin. The implementation `await`s the delete
 *    before the subsequent write so the encrypted record is observably
 *    gone by the time the promise resolves.
 *
 * 2. **FR-007**: `clearAll` MUST be a single Dexie transaction spanning
 *    every store in the schema. Two-stage wipes (token-clear-then-rest)
 *    are a contract violation. Dexie's native transaction atomicity is
 *    the enforcement mechanism — a mid-transaction throw rolls the
 *    whole wipe back, so the credentials table is never empty while the
 *    cache tables still hold rows.
 *
 * 3. **Web Crypto AES-GCM** (Constitution Principle IV / spec FR-002a):
 *    token encryption uses the helpers in `src/data/crypto/token-crypto`
 *    exclusively. The repository deliberately does not pull in any
 *    alternative crypto path (no `crypto-js`, no `node:crypto`, no
 *    hand-rolled XOR) so the threat model and audit surface in the
 *    token-crypto module are the only ones that need review.
 *
 * 4. **URL / log / value safety (FR-008)**: the repository never echoes
 *    the plaintext token back to its caller. `setSessionToken` and
 *    `setPersistentToken` return `Promise<void>`; the masked identifier
 *    is the only representation the rest of the app is permitted to
 *    render, and the repository exposes it through the persisted
 *    record's `maskedIdentifier` field for the provider to surface.
 *
 * Determinism
 * -----------
 * The repository does not depend on wall-clock time or live network
 * access. All crypto randomness is sourced from `crypto.getRandomValues`
 * so the test golden-state fixtures are deterministic at the
 * contract-surface level (the bytes themselves are fresh per call; the
 * shape and invariants are pinned).
 *
 * Boundary
 * --------
 * This module lives under `src/data/**` and imports from
 * `src/data/db/schema.ts` (Dexie) and `src/data/crypto/token-crypto.ts`
 * (Web Crypto helpers). It does not import from `src/app/**`,
 * `src/features/**`, `src/domain/**`, or `src/shared/**` — keeping the
 * dependency one-way is what lets the dependency-boundary lint rule in
 * `eslint.config.js` enforce the no-feature-from-data rule by review
 * convention without a runtime exception.
 */
import { encryptToken, generateTokenKey } from "../../crypto/token-crypto";
import { db, type CredentialRecord } from "../schema";

/**
 * The Dexie primary key the `credentials` table is keyed on. The
 * contract treats the persistent row as a singleton (the schema's only
 * index is `mode`) — the credentials table holds zero rows in session
 * mode and exactly one row in persistent mode. Centralising the literal
 * here means a future schema change that switches the primary key
 * (e.g. to a UUID generated per row) only needs to update this constant
 * to keep the repository in sync.
 */
const PERSISTENT_MODE_KEY = "persistent" as const;

/**
 * The full Dexie table list that FR-007's single-transaction wipe must
 * span. Mirrors the store list in `src/data/db/schema.ts` and the
 * contract in `contracts/storage-repository.md`. The list is kept here
 * as a local constant (rather than derived from `db.tables`) so the
 * contract is explicit at the call site and a future schema addition
 * that forgets to update this list fails the
 * `tests/contract/credential-repository.test.ts` "every store" assertion
 * before it ships.
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
 * The `CredentialRepository` surface — the contract every caller
 * composes against. Exported as a TypeScript interface so the
 * `CredentialsProvider` and the Settings panel can take a
 * `CredentialRepository` dependency (e.g. for test fixtures) without
 * importing the singleton instance.
 */
export interface CredentialRepository {
  /**
   * Read the persisted credential. Returns the singleton persistent
   * record when one exists, or `null` when the Dexie `credentials`
   * table is empty (the first-run / session-only state — there is no
   * persisted record for a session-only token because the session
   * token lives in memory only, per FR-002a).
   */
  getCurrent(): Promise<CredentialRecord | null>;

  /**
   * Hold the token in memory only. MUST NOT write a new credential row
   * to Dexie. When a prior persistent row exists it MUST be deleted
   * immediately (FR-005a) so the encrypted token + non-extractable key
   * handle are not left on disk after the user switches back to
   * session-only storage.
   */
  setSessionToken(token: string): Promise<void>;

  /**
   * Encrypt the token under a fresh non-extractable AES-GCM key and
   * persist the resulting `EncryptedTokenRecord`. MUST delete the prior
   * encrypted record first (FR-005a) — a deferred or staged delete is
   * a contract violation. The persisted record's `maskedIdentifier` is
   * the last four characters of the token (the only representation the
   * rest of the app is permitted to render, FR-008).
   */
  setPersistentToken(token: string): Promise<void>;

  /**
   * Delete the persistent row and its associated `CryptoKey` handle.
   * MUST NOT touch any other Dexie store — the cache / snapshots /
   * team-mapping overrides survive a session-only fallback. The full
   * data wipe is the FR-007 single-action contract, not this one.
   */
  clearToSessionOnly(): Promise<void>;

  /**
   * FR-007 single-action wipe. MUST be a single Dexie transaction
   * spanning every store in the schema. A partial clear (e.g. token
   * wiped but cache retained) is a contract violation; Dexie's native
   * transaction atomicity is the enforcement mechanism.
   */
  clearAll(): Promise<void>;
}

/**
 * The masked identifier the rest of the app is permitted to render
 * (FR-008). Exported so the `CredentialsProvider` can derive the same
 * masked value from the in-memory session token without having to
 * duplicate the last-four rule.
 */
export function maskTokenIdentifier(token: string): string {
  if (token.length <= 4) {
    return token;
  }
  return token.slice(-4);
}

/**
 * The repository singleton. The module exports both the interface and
 * the implementation so a test can construct a fake `CredentialRepository`
 * (e.g. backed by a different database name) without monkey-patching the
 * global instance.
 */
export const credentialRepository: CredentialRepository = {
  async getCurrent(): Promise<CredentialRecord | null> {
    const stored = await db.credentials.get(PERSISTENT_MODE_KEY);
    return stored ?? null;
  },

  async setSessionToken(_token: string): Promise<void> {
    // FR-005a — switching from persistent mode back to session-only
    // immediately deletes the previous encrypted token record and its
    // associated non-extractable key. The `delete` is awaited so the
    // encrypted record is observably gone by the time the returned
    // promise resolves — the caller (the `CredentialsProvider`) holds
    // a reference to the in-memory token and does not need a Dexie
    // round-trip to confirm the switch.
    await db.credentials.delete(PERSISTENT_MODE_KEY);
    // Deliberately no Dexie write: the session-mode token is held in
    // memory only (contracts/storage-repository.md), and the caller
    // owns the in-memory lifetime.
  },

  async setPersistentToken(token: string): Promise<void> {
    // FR-005a — replacing the prior encrypted record (or switching
    // from session-only into persistent) MUST immediately delete the
    // previous encrypted token record and its non-extractable key. The
    // `delete` is awaited before the subsequent `put` so the old
    // encrypted blob is gone by the time the new one is written.
    await db.credentials.delete(PERSISTENT_MODE_KEY);

    // FR-002a — encrypt the token under a freshly generated
    // non-extractable AES-GCM key. The key is non-extractable so the
    // raw key material cannot be copied out of the SubtleCrypto handle
    // by reading the browser's storage files (a copied profile
    // directory attack). The IV is generated inside `encryptToken` per
    // call (AES-GCM MUST NOT be reused with the same key+IV pair).
    const key = await generateTokenKey();
    const { ciphertext, iv } = await encryptToken(token, key);

    await db.credentials.put({
      mode: "persistent",
      encryptedTokenRecord: { ciphertext, iv, keyRef: key },
      maskedIdentifier: maskTokenIdentifier(token),
      lastValidatedAt: null,
      lastValidationResult: null,
    });
  },

  async clearToSessionOnly(): Promise<void> {
    // FR-005a — switching from persistent mode back to session-only
    // immediately deletes the persistent encrypted record. The Dexie
    // primary-key `delete` is sufficient because the credentials table
    // only ever holds the singleton persistent row keyed by `mode`.
    await db.credentials.delete(PERSISTENT_MODE_KEY);
    // Deliberately no writes to other stores: the session-only fallback
    // is a soft state-change, not a data wipe. Cache / snapshots /
    // team-mapping overrides survive untouched.
  },

  async clearAll(): Promise<void> {
    // FR-007 — a single Dexie transaction spanning every store in the
    // schema. The transaction is `rw` (read-write) on every store up
    // front so Dexie's transaction atomicity is the enforcement
    // mechanism: any throw inside the body rolls the whole span back,
    // and either every store is cleared or none of them is. A
    // two-stage implementation (clear credentials first, then start a
    // second transaction for the rest) would leave the credentials
    // table empty while the cache tables still hold rows — a partial
    // clear that violates the spec's "one explicit action that clears
    // the token and all locally retained Asana data together" wording.
    await db.transaction("rw", [...ALL_DATA_TABLE_NAMES], async () => {
      for (const tableName of ALL_DATA_TABLE_NAMES) {
        await db.table(tableName).clear();
      }
    });
  },
};
