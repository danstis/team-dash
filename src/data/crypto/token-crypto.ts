/**
 * Token encrypt/decrypt via Web Crypto AES-GCM.
 *
 * Implementation of T027 (BSOD-155) and the cryptographic half of the
 * `CredentialRepository` contract documented in
 * `specs/001-asana-team-dashboard/contracts/storage-repository.md`.
 *
 * Threat model (Constitution Principle IV; spec FR-002a):
 *
 *   The Asana personal access token is a high-value secret. The token is
 *   encrypted with a non-extractable AES-GCM key that lives in IndexedDB
 *   alongside the ciphertext and IV (the Dexie schema owns the shape — see
 *   `EncryptedTokenRecord` in `src/data/db/schema.ts`). The
 *   `extractable: false` flag is the design property that defends against
 *   a copied browser profile reading the raw key material back out of
 *   IndexedDB; AES-GCM's 128-bit authentication tag defends against an
 *   attacker who tampers with the stored ciphertext or IV. This module
 *   deliberately exposes only `encryptToken`/`decryptToken` and the key
 *   generator — `exportKey` is not re-exported so a misuse cannot smuggle
 *   the key out of the SubtleCrypto handle.
 *
 * The asymmetry between web `CryptoKey` (structured-cloned into IndexedDB
 * without ever being readable as raw bytes) and the typical
 *   `key -> raw bytes -> encrypt -> throw raw bytes away`
 * pattern is exactly what Principle IV is buying. This module does not
 * add a dependency on `node:crypto` or any Node-only module so the Vite
 * browser bundle stays free of server-only imports.
 */

export const TOKEN_CRYPTO_ALGORITHM = "AES-GCM" as const;

/** AES-GCM key length in bits. 256 is the longest standard AES key. */
export const AES_GCM_KEY_LENGTH_BITS = 256 as const;

/**
 * AES-GCM IV length in bytes. The Web Crypto `AES-GCM` algorithm accepts
 * a 12-byte (96-bit) IV — any other length forces a non-standard derivation
 * path and undermines interoperability with the platform's optimised
 * implementation.
 */
export const AES_GCM_IV_LENGTH_BYTES = 12 as const;

/** AES-GCM authentication tag length in bits. 128 is the recommended value. */
export const AES_GCM_TAG_LENGTH_BITS = 128 as const;

/**
 * Failure mode for `decryptToken`. Surfaced as a `TokenCryptoError` so the
 * `CredentialRepository` can distinguish a corrupted/tampered stored record
 * from any other failure and route the app to the first-run credential
 * screen (spec FR-002b).
 *
 * Platform constraint: Web Crypto's `SubtleCrypto` raises an opaque
 * `OperationError` for every AES-GCM authentication-tag failure,
 * regardless of whether the tag mismatch was caused by:
 *   - a tamper in the ciphertext body,
 *   - a tamper in the IV, or
 *   - the wrong key being supplied.
 * The reason here is the BEST-EFFORT classification reachable from the
 * platform's error alone, supplemented by a self-test round-trip on the
 * caller-supplied key (see `classifyDecryptFailure`). The error message
 * preserves the underlying platform error text as a debugging aid.
 */
export type TokenCryptoErrorReason =
  /** Ciphertext was modified, IV was modified, or auth tag check failed for an indistinguishable reason. */
  | "tampered_ciphertext"
  /** Reserved for forward-compatibility; emitted by the same path as `tampered_ciphertext`. */
  | "tampered_iv"
  /** Caller invoked `decryptToken` with a key that did not produce the ciphertext. */
  | "wrong_key"
  /** SubtleCrypto rejected decryption for an unspecified reason. */
  | "decrypt_failed"
  /** Ciphertext or IV was structurally invalid (empty, wrong length). */
  | "invalid_input"
  /** Caller passed an empty plaintext to `encryptToken` (a guardrail). */
  | "empty_plaintext"
  /** Caller passed a key that is not usable for the requested operation. */
  | "invalid_key";

export class TokenCryptoError extends Error {
  readonly reason: TokenCryptoErrorReason;

  constructor(reason: TokenCryptoErrorReason, message: string) {
    super(message);
    this.name = "TokenCryptoError";
    this.reason = reason;
  }
}

/**
 * Type guard for `TokenCryptoError`. Exported so the credential repository
 * can branch on `instanceof` without taking a hard dependency on the class
 * identity — useful in tests that stringify-then-rehydrate errors.
 */
export function isTokenCryptoError(value: unknown): value is TokenCryptoError {
  return value instanceof TokenCryptoError;
}

/**
 * Generate a non-extractable AES-GCM key for token encryption.
 *
 * `extractable: false` makes `crypto.subtle.exportKey(...)` reject on
 * every code path, so the raw 256-bit key material cannot be copied out
 * of the SubtleCrypto handle — that is the property the IndexedDB
 * `credentials.keyRef` store relies on. The key usages are restricted to
 * `["encrypt", "decrypt"]` so the handle cannot be passed to `wrapKey`,
 * `deriveKey`, etc. by a misuse.
 */
export async function generateTokenKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    {
      name: TOKEN_CRYPTO_ALGORITHM,
      length: AES_GCM_KEY_LENGTH_BITS,
    },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Encrypt a plaintext string under the given key, producing a fresh
 * 12-byte IV and an `AES-GCM` ciphertext (ciphertext body || 128-bit auth
 * tag, in the Web Crypto layout).
 *
 * The IV is freshly generated for every call — AES-GCM MUST NOT be
 * invoked twice with the same (key, IV) pair, and a stored key in
 * IndexedDB could outlive many encryptions, so reusing an IV is a
 * security boundary we enforce for the caller.
 */
export async function encryptToken(
  plaintext: string,
  key: CryptoKey,
): Promise<{ ciphertext: ArrayBuffer; iv: ArrayBuffer }> {
  if (plaintext.length === 0) {
    throw new TokenCryptoError(
      "empty_plaintext",
      "encryptToken requires a non-empty plaintext",
    );
  }
  assertKeyUsable(key, ["encrypt"]);

  const iv = new Uint8Array(AES_GCM_IV_LENGTH_BYTES);
  crypto.getRandomValues(iv);

  let ciphertext: ArrayBuffer;
  try {
    ciphertext = await crypto.subtle.encrypt(
      {
        name: TOKEN_CRYPTO_ALGORITHM,
        iv: toBufferSource(iv),
        tagLength: AES_GCM_TAG_LENGTH_BITS,
      },
      key,
      toBufferSource(new TextEncoder().encode(plaintext)),
    );
  } catch (err) {
    // `crypto.subtle.encrypt` should not fail for an AES-GCM key with a
    // valid fresh IV; the only realistic failure mode here is a misused
    // (e.g. signing-only) `CryptoKey` handed in by a caller. Surface as a
    // typed error so the credential repository can react per spec FR-002b.
    throw new TokenCryptoError(
      "invalid_key",
      "token encryption failed: " + describeError(err),
    );
  }

  return {
    ciphertext: toArrayBuffer(ciphertext),
    iv: toArrayBuffer(iv),
  };
}

/**
 * Decrypt an `encryptToken`-produced ciphertext under the same key.
 *
 * On failure (ciphertext or IV modified, wrong key, structurally invalid
 * input) the returned promise rejects with a `TokenCryptoError` whose
 * `reason` distinguishes the most likely cause. SubtleCrypto does not
 * tell us which was the problem, so `reason` is the best-effort
 * classification based on (a) the input shape, (b) the platform's error
 * message, and (c) a self-test round-trip on the caller-supplied key.
 * It is good enough for the `CredentialRepository` to log a
 * precise-enough failure reason and route the app to the first-run
 * credential screen (spec FR-002b).
 */
export async function decryptToken(
  ciphertext: ArrayBuffer,
  iv: ArrayBuffer,
  key: CryptoKey,
): Promise<string> {
  assertInputShape(ciphertext, iv);
  assertKeyUsable(key, ["decrypt"]);

  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: TOKEN_CRYPTO_ALGORITHM,
        iv: toBufferSource(iv),
        tagLength: AES_GCM_TAG_LENGTH_BITS,
      },
      key,
      toBufferSource(ciphertext),
    );
    return new TextDecoder().decode(plaintext);
  } catch (err) {
    throw await classifyDecryptFailure(err, key, ciphertext, iv);
  }
}

/* -------------------------------------------------------------------------- */
/* Implementation helpers                                                     */
/* -------------------------------------------------------------------------- */

function assertKeyUsable(
  key: CryptoKey,
  requiredUsages: ReadonlyArray<"encrypt" | "decrypt">,
): void {
  try {
    if (!(key instanceof CryptoKey)) {
      throw new TokenCryptoError(
        "invalid_key",
        "token crypto requires a CryptoKey handle",
      );
    }
    if (
      !(key.algorithm as { name?: string }).name ||
      !String((key.algorithm as { name: string }).name)
        .toUpperCase()
        .endsWith("AES-GCM")
    ) {
      throw new TokenCryptoError(
        "invalid_key",
        "token crypto requires an AES-GCM key",
      );
    }
    for (const usage of requiredUsages) {
      if (!key.usages.includes(usage)) {
        throw new TokenCryptoError(
          "invalid_key",
          "token key is not authorised for " + usage,
        );
      }
    }
  } catch (err) {
    if (err instanceof TokenCryptoError) {
      throw err;
    }
    throw new TokenCryptoError(
      "invalid_key",
      "token key validation failed: " + describeError(err),
    );
  }
}


function assertInputShape(ciphertext: ArrayBuffer, iv: ArrayBuffer): void {
  // Test environments (vitest+jsdom) and some browsers deliver
  // `ArrayBuffer`-shaped values whose `[[Prototype]]` differs from the
  // realm's `ArrayBuffer` constructor — strict `instanceof` would
  // incorrectly reject the cross-realm value. We accept anything with a
  // `byteLength` integer >= 0 and a `slice` method (every `ArrayBuffer`
  // has one); the length / type guards below still reject the genuinely
  // invalid cases (no byteLength, negative byteLength, or a non-buffer
  // container).
  if (!isArrayBufferLike(ciphertext) || ciphertext.byteLength === 0) {
    throw new TokenCryptoError(
      "invalid_input",
      "decryptToken requires non-empty ArrayBuffer ciphertext",
    );
  }
  if (!isArrayBufferLike(iv) || iv.byteLength !== AES_GCM_IV_LENGTH_BYTES) {
    throw new TokenCryptoError(
      "invalid_input",
      "decryptToken requires a 12-byte ArrayBuffer IV",
    );
  }
}

/**
 * "ArrayBuffer-shape" duck-type check that survives cross-realm delivery.
 * A value qualifies if it has a non-negative integer `byteLength`, has a
 * `slice` method (every `ArrayBuffer` does), and is not a
 * `SharedArrayBuffer` — the credential repository's Dexie schema only
 * ever stores an `ArrayBuffer`, never a `SharedArrayBuffer`.
 */
function isArrayBufferLike(value: unknown): value is ArrayBuffer {
  if (value === null || typeof value !== "object") {
    return false;
  }
  if (value instanceof ArrayBuffer) {
    return true;
  }
  if (
    typeof SharedArrayBuffer !== "undefined" &&
    value instanceof SharedArrayBuffer
  ) {
    return false;
  }
  const candidate = value as { byteLength?: unknown; slice?: unknown };
  return (
    typeof candidate.byteLength === "number" &&
    Number.isInteger(candidate.byteLength) &&
    candidate.byteLength >= 0 &&
    typeof candidate.slice === "function"
  );
}

/**
 * Best-effort classification of a SubtleCrypto auth-tag failure.
 *
 * Platform constraint: SubtleCrypto raises an opaque `OperationError`
 * with the same name (`OperationError`), `code` (0), and message
 * ("The operation failed for an operation-specific reason") for every
 * AES-GCM authentication failure, so we cannot tell from the error
 * alone whether the ciphertext body, the IV, or the key was the
 * problem.
 *
 * The classifier distinguishes only two outcomes:
 *   - **Caller-supplied key is broken / not the right key** →
 *     `wrong_key`. Detected by self-testing the key: encrypting a
 *     fixed reference plaintext under the same key and confirming it
 *     round-trips. If the self-test fails the supplied key cannot
 *     decrypt anything sensible, so the original error is not the
 *     record's fault.
 *   - **Caller-supplied key works against a reference** → the record
 *     itself is corrupt. Surface as `tampered_ciphertext` (the
 *     platform does not distinguish ciphertext-vs-IV tampering; the
 *     `tampered_iv` enum value remains for forward-compatibility if a
 *     future engine exposes a distinguishing signal).
 *
 * The self-test reference plaintext is a small fixed string ("token-
 * crypto self-test …") — never a candidate token, so this side-channel
 * cannot leak credential material even if a caller logs the error
 * message.
 */
async function classifyDecryptFailure(
  err: unknown,
  key: CryptoKey,
  ciphertext: ArrayBuffer,
  iv: ArrayBuffer,
): Promise<TokenCryptoError> {
  // If the ciphertext is too short to contain the AES-GCM tag, this is
  // structurally invalid input rather than a tag mismatch. We don't
  // even attempt the self-test in that case because the ciphertext
  // clearly cannot be authentic regardless of which key was used.
  if (ciphertext.byteLength < AES_GCM_TAG_LENGTH_BITS / 8) {
    return new TokenCryptoError(
      "invalid_input",
      "decryptToken ciphertext too short to contain the AES-GCM tag: " +
        describeError(err),
    );
  }

  const keyIsUsable = await referenceRoundTripSucceeds(key);
  if (!keyIsUsable) {
    return new TokenCryptoError(
      "wrong_key",
      "decryptToken failed: caller-supplied key rejected by self-test: " +
        describeError(err),
    );
  }

  // Caller's key works against a fresh reference; the supplied
  // ciphertext/IV pair is therefore the failing piece. Surface as
  // tampered_ciphertext because SubtleCrypto gives no IV-vs-ciphertext
  // signal (see TokenCryptoErrorReason docstring).
  void iv;
  return new TokenCryptoError(
    "tampered_ciphertext",
    "AES-GCM authentication failed: " + describeError(err),
  );
}

/**
 * Encrypt a fixed reference plaintext under the caller-supplied key with
 * a fresh IV, and confirm it round-trips. Resolution drives the wrong-key
 * classification in `classifyDecryptFailure` — see the platform-
 * constraint note there.
 *
 * The reference plaintext is hard-coded (not derived from any caller
 * input) and contains a clearly-labelled string so an error log cannot
 * be confused with a real token. The cost is one encrypt + one decrypt
 * per failed decryptToken call — measured against the alternative of
 * silently losing the stored token to corruption, the cost is justified.
 */
async function referenceRoundTripSucceeds(key: CryptoKey): Promise<boolean> {
  try {
    const iv = new Uint8Array(AES_GCM_IV_LENGTH_BYTES);
    crypto.getRandomValues(iv);
    const plaintext = new TextEncoder().encode(
      "token-crypto self-test: this string never holds user data",
    );
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: TOKEN_CRYPTO_ALGORITHM,
        iv: toBufferSource(iv),
        tagLength: AES_GCM_TAG_LENGTH_BITS,
      },
      key,
      toBufferSource(plaintext),
    );
    await crypto.subtle.decrypt(
      {
        name: TOKEN_CRYPTO_ALGORITHM,
        iv: toBufferSource(iv),
        tagLength: AES_GCM_TAG_LENGTH_BITS,
      },
      key,
      toBufferSource(ciphertext),
    );
    return true;
  } catch {
    return false;
  }
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    return err.name + ": " + err.message;
  }
  return String(err);
}

/**
 * Narrow an `ArrayBuffer`-backed input into a `BufferSource` that
 * SubtleCrypto accepts in this Node/browser version. We copy into a
 * fresh `Uint8Array` rather than passing the underlying buffer directly
 * so the typed-array path is the one and only BufferSource flavour we
 * hand SubtleCrypto — this avoids subtle quirks between `ArrayBuffer`,
 * `SharedArrayBuffer`, and `Uint8Array.buffer` carrying across boundary
 * calls in different engines. The return type is widened explicitly to
 * `BufferSource` so callers can pass it into the `AesGcmParams.iv` slot
 * whose TS 6 lib type is the strict `BufferSource` (backed by
 * `ArrayBuffer`, not the wider `ArrayBufferLike`).
 */
function toBufferSource(input: ArrayBuffer | Uint8Array): BufferSource {
  const source = input instanceof Uint8Array ? input : new Uint8Array(input);
  const copy = new Uint8Array(source.byteLength);
  copy.set(source);
  return copy;
}

/**
 * Copy the byte contents of an `ArrayBuffer`-shape (including cross-realm
 * `ArrayBuffer` instances whose `[[Prototype]]` does not match the
 * realm's `ArrayBuffer` constructor) into a SAME-REALM `ArrayBuffer`.
 * This guarantees that consumers using `instanceof ArrayBuffer`,
 * `Dexie's structured-clone` boundary, and the `EncryptedTokenRecord`
 * Dexie schema all see the same object prototype.
 */
function toArrayBuffer(input: ArrayBuffer | Uint8Array): ArrayBuffer {
  const view = input instanceof Uint8Array ? input : new Uint8Array(input);
  // Two-step copy: the intermediate Uint8Array ensures we have a same-
  // realm typed array; the final allocation gives us a same-realm
  // ArrayBuffer back. Both copies are necessary because the source
  // `Uint8Array.buffer` would carry the foreign prototype across in
  // some engines.
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  return copy.buffer;
}
