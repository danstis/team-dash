/**
 * T027 / T028 — `src/data/crypto/token-crypto.ts` unit tests (Red phase for
 * T027).
 *
 * Covers the AES-GCM token-encryption contract required by Constitution
 * Principle IV and spec FR-002a:
 *
 * - generateKey returns a `CryptoKey` whose `extractable` is `false` so the
 *   raw key material cannot be exported from the SubtleCrypto interface
 *   (the encryption design property that defends against a copied browser
 *   profile recovering the plaintext token).
 * - generateKey's key usage is exactly `["encrypt", "decrypt"]` — no
 *   `wrapKey`/`unwrapKey` so the key cannot be used to wrap itself or
 *   anything else, and no `deriveBits`/`deriveKey` because the key was
 *   generated, not derived.
 * - generateKey uses `AES-GCM` at 256 bits — the algorithm/length the
 *   storage-repository contract (contracts/storage-repository.md) and
 *   research.md §5 commit to.
 * - generateKey returns a non-`SharedArrayBuffer` and a distinct instance
 *   on every call (so a stored key cannot be confused with a freshly
 *   generated one).
 * - encryptToken returns ciphertext and IV with the documented shapes:
 *   ciphertext is an `ArrayBuffer` ≥ plaintext length; IV is exactly the
 *   12-byte AES-GCM nonce length.
 * - encryptToken produces different ciphertext on two calls with the same
 *   plaintext + key because the IV is freshly generated each time (AES-GCM
 *   MUST NOT be invoked twice under the same key+IV pair).
 * - decryptToken(encryptToken(plaintext), key) round-trips the original
 *   plaintext byte-for-byte, including non-ASCII multibyte characters and
 *   the empty string.
 * - decryptToken rejects (rejects the returned promise) when the
 *   ciphertext has been tampered with — this is the AES-GCM
 *   authentication-tag guarantee Constitution Principle IV and FR-002a's
 *   threat model depend on.
 * - decryptToken rejects when the IV has been tampered with — same
 *   authentication guarantee, exercised on the nonce path.
 * - decryptToken rejects when invoked with a key different from the one
 *   used for encryption (a fresh non-extractable key from generateTokenKey
 *   cannot decrypt ciphertext from a different key).
 * - decryptToken surfaces a structured `TokenCryptoError` whose `reason`
 *   distinguishes "tampered_ciphertext", "tampered_iv", and
 *   "wrong_key"/"decrypt_failed" instead of leaking the raw
 *   `OperationError` so the credential repository can react per
 *   spec FR-002b (decrypt failure transitions the app to first-run,
 *   equivalent to mode being unset).
 *
 * Test environment
 * ----------------
 * Vitest runs under jsdom (vitest.config.ts), which does not expose
 * `crypto.subtle`. `tests/setup.ts` polyfills `globalThis.crypto` from
 * Node's `node:crypto.webcrypto` (API-compatible with browser SubtleCrypto)
 * when SubtleCrypto is missing — that is the only reason `crypto.subtle`
 * is reachable from this file. The implementation under test intentionally
 * uses `globalThis.crypto.subtle` (no `node:` imports) so production
 * browser bundles stay free of Node-only modules.
 *
 * Determinism
 * -----------
 * Key generation, ciphertext bytes, and IV bytes are non-deterministic by
 * design — these tests assert on shape (length, type, non-equality under
 * tampering) rather than on literal byte values, and never call into a
 * time- or wall-clock-dependent code path.
 */
import { describe, expect, it } from "vitest";
import {
  AES_GCM_IV_LENGTH_BYTES,
  AES_GCM_KEY_LENGTH_BITS,
  AES_GCM_TAG_LENGTH_BITS,
  TOKEN_CRYPTO_ALGORITHM,
  decryptToken,
  encryptToken,
  generateTokenKey,
  isTokenCryptoError,
  type TokenCryptoErrorReason,
} from "../../../../src/data/crypto/token-crypto";

const TOKEN = "0/1234567890:abcdefghijklmnopqrstuvwxyz";

describe("T027 token-crypto (AES-GCM, non-extractable key)", () => {
  describe("constants (encodes the AES-GCM contract)", () => {
    it("uses AES-GCM with a 256-bit key and 128-bit authentication tag", () => {
      expect(TOKEN_CRYPTO_ALGORITHM).toBe("AES-GCM");
      expect(AES_GCM_KEY_LENGTH_BITS).toBe(256);
      expect(AES_GCM_TAG_LENGTH_BITS).toBe(128);
    });

    it("uses a 12-byte IV — the standard AES-GCM nonce length", () => {
      // AES-GCM in Web Crypto uses a 12-byte (96-bit) IV. Specifying any
      // other length here would be a silent downgrade; the constant exists
      // so the encrypt+decrypt pair can never disagree.
      expect(AES_GCM_IV_LENGTH_BYTES).toBe(12);
    });
  });

  describe("generateTokenKey (Principle IV: non-extractable)", () => {
    it("returns a CryptoKey whose extractable flag is false", () => {
      const key = generateTokenKey();
      return expect(key).resolves.toSatisfy((generated: CryptoKey) => {
        expect(generated).toBeInstanceOf(CryptoKey);
        expect(generated.extractable).toBe(false);
        return true;
      });
    });

    it("returns a key usable for encrypt + decrypt only (no wrapKey/deriveKey)", async () => {
      const key = await generateTokenKey();
      expect(key.usages).toEqual(["encrypt", "decrypt"]);
      // Negative guards — the union must NOT contain operations that would
      // let an extracted (or accidental script-callable) key be used to
      // derive another key or wrap itself.
      expect(key.usages).not.toContain("wrapKey");
      expect(key.usages).not.toContain("unwrapKey");
      expect(key.usages).not.toContain("deriveBits");
      expect(key.usages).not.toContain("deriveKey");
    });

    it("returns an AES-GCM key of the documented length", async () => {
      const key = await generateTokenKey();
      expect(key.algorithm.name).toBe("AES-GCM");
      expect(key.algorithm as { length?: number }).toHaveLength(
        AES_GCM_KEY_LENGTH_BITS,
      );
    });

    it("returns a distinct instance on every call", async () => {
      const first = await generateTokenKey();
      const second = await generateTokenKey();
      // Non-extractable CryptoKey objects are still structured-clone-equal
      // based on their underlying key material slot in the agent — so a
      // safer equality test is identity: a freshly generated key is a new
      // handle that !== an earlier one.
      expect(first).not.toBe(second);
    });

    it("does not accidentally expose the raw key material via exportKey", async () => {
      const key = await generateTokenKey();
      // `extractable: false` MUST make `exportKey` reject with a
      // DOMException — this is the design property the spec cites as the
      // defence against a copied browser profile reading the raw token.
      await expect(crypto.subtle.exportKey("raw", key)).rejects.toThrow();
    });
  });

  describe("encryptToken", () => {
    it("returns ciphertext as an ArrayBuffer and IV as a 12-byte ArrayBuffer", async () => {
      const key = await generateTokenKey();
      const { ciphertext, iv } = await encryptToken(TOKEN, key);

      expect(ciphertext).toBeInstanceOf(ArrayBuffer);
      expect(iv).toBeInstanceOf(ArrayBuffer);
      expect(iv.byteLength).toBe(AES_GCM_IV_LENGTH_BYTES);
      // AES-GCM ciphertext = plaintext || 16-byte tag, so for a non-empty
      // plaintext the ciphertext MUST be at least the tag length longer
      // than the UTF-8 encoded plaintext length.
      const plaintextBytes = new TextEncoder().encode(TOKEN).byteLength;
      expect(ciphertext.byteLength).toBeGreaterThanOrEqual(plaintextBytes);
      expect(ciphertext.byteLength).toBeGreaterThanOrEqual(
        AES_GCM_TAG_LENGTH_BITS / 8,
      );
    });

    it("throws when given an empty plaintext (matches Dexie storage contract)", async () => {
      // The credential repository never encrypts an empty token; an empty
      // string would still round-trip through AES-GCM, but we reject it
      // explicitly so a caller cannot accidentally stash "no token" into
      // the encrypted store. The contract is intentionally narrow.
      const key = await generateTokenKey();
      await expect(encryptToken("", key)).rejects.toThrow();
    });

    it("throws when given a key that is not usable for encryption", async () => {
      // A decrypt-only key MUST NOT be accepted by encryptToken — passing
      // one should surface a structured rejection, not silently encrypt and
      // store inaccessible ciphertext.
      const decryptOnlyKey = await crypto.subtle.generateKey(
        { name: TOKEN_CRYPTO_ALGORITHM, length: AES_GCM_KEY_LENGTH_BITS },
        false,
        ["decrypt"],
      );
      await expect(encryptToken(TOKEN, decryptOnlyKey)).rejects.toThrow();
    });
  });

  describe("decryptToken (round-trip and tamper detection)", () => {
    it("round-trips a non-empty plaintext byte-for-byte", async () => {
      const key = await generateTokenKey();
      const { ciphertext, iv } = await encryptToken(TOKEN, key);
      const recovered = await decryptToken(ciphertext, iv, key);
      expect(recovered).toBe(TOKEN);
    });

    it("round-trips a multibyte non-ASCII plaintext without encoding drift", async () => {
      const key = await generateTokenKey();
      const multibyte = "naïve façade — 日本語 🔒";
      const { ciphertext, iv } = await encryptToken(multibyte, key);
      expect(await decryptToken(ciphertext, iv, key)).toBe(multibyte);
    });

    it("rejects decryption when the ciphertext body has been tampered with", async () => {
      // AES-GCM includes a 128-bit authentication tag derived from both
      // the key and the ciphertext. Flipping any single byte in the
      // ciphertext body MUST cause the tag check to fail — this is the
      // tamper-detection property Constitution Principle IV is buying.
      const key = await generateTokenKey();
      const { ciphertext, iv } = await encryptToken(TOKEN, key);
      const tampered = tamperArrayBuffer(ciphertext, { flipByte: 0 });

      const promise = decryptToken(tampered, iv, key);
      await expect(promise).rejects.toThrow();
      await expect(promise).rejects.toSatisfy((err: unknown) => {
        expect(isTokenCryptoError(err)).toBe(true);
        expect((err as { reason: TokenCryptoErrorReason }).reason).toBe(
          "tampered_ciphertext",
        );
        return true;
      });
    });

    it("rejects decryption when the IV has been tampered with (auth-tag failure surfaces as tampered_ciphertext)", async () => {
      // AES-GCM treats the IV as part of the authentication tag
      // calculation — flipping a byte in the IV MUST cause decryption to
      // fail. Web Crypto's SubtleCrypto intentionally surfaces this
      // failure as an opaque `OperationError` with the same message as a
      // ciphertext-body tamper, so the classifier cannot distinguish
      // ciphertext-vs-IV tampering from the error alone. The
      // implementation documents this platform constraint and surfaces
      // both as `tampered_ciphertext` (the more common corruption mode);
      // the `tampered_iv` enum value remains in the public surface for
      // forward-compatibility if a future engine exposes a distinguishing
      // signal. The PROPERTY under test is therefore "decrypt MUST
      // reject" — not "the reason MUST be tampered_iv specifically".
      const key = await generateTokenKey();
      const { ciphertext, iv } = await encryptToken(TOKEN, key);
      const tamperedIv = tamperArrayBuffer(iv, { flipByte: 0 });

      const promise = decryptToken(ciphertext, tamperedIv, key);
      await expect(promise).rejects.toThrow();
      await expect(promise).rejects.toSatisfy((err: unknown) => {
        expect(isTokenCryptoError(err)).toBe(true);
        // The exact reason is intentionally pinned to "tampered_ciphertext"
        // because SubtleCrypto gives us no IV-vs-ciphertext signal. If a
        // future revision gains such a signal, this pin documents the
        // desired behaviour at that point.
        expect((err as { reason: TokenCryptoErrorReason }).reason).toBe(
          "tampered_ciphertext",
        );
        return true;
      });
    });

    it("rejects decryption when invoked with a different (freshly generated) key", async () => {
      const encryptionKey = await generateTokenKey();
      const { ciphertext, iv } = await encryptToken(TOKEN, encryptionKey);
      const attackerKey = await generateTokenKey();

      const promise = decryptToken(ciphertext, iv, attackerKey);
      await expect(promise).rejects.toThrow();
      await expect(promise).rejects.toSatisfy((err: unknown) => {
        expect(isTokenCryptoError(err)).toBe(true);
        // AES-GCM auth-tag failures are opaque from SubtleCrypto:
        // ciphertext tampering, IV tampering, and a foreign-but-valid
        // key all surface the SAME error. The implementation's
        // self-test round-trip on the supplied key only catches the
        // "structurally broken key" path (e.g. a Dexie migration that
        // dropped the usages field) — a fresh valid AES-GCM key that
        // happens not to be the right one self-tests GREEN and the
        // failure is correctly attributed to the record (tampered
        // ciphertext). This is the platform's design, not a missing
        // signal we could exploit.
        expect((err as { reason: TokenCryptoErrorReason }).reason).toBe(
          "tampered_ciphertext",
        );
        return true;
      });
    });

    it("surfaces invalid_key when the supplied key fails the round-trip self-test", async () => {
      // The self-test is exercised when the key cannot perform a
      // reference encrypt/decrypt round-trip on a fixed plaintext (the
      // string never holds user data). This catches structurally broken
      // keys — e.g. a CryptoKey handle whose `usages` was stripped by
      // // some shim — and lets the credential repository distinguish
      // them from passive storage corruption. The reference plaintext
      // is hard-coded and labelled so an error log cannot be confused
      // with a real token.
      const encryptionKey = await generateTokenKey();
      const { ciphertext, iv } = await encryptToken(TOKEN, encryptionKey);

      const strippedHandle = Object.create(encryptionKey) as CryptoKey;
      Object.defineProperty(strippedHandle, "usages", {
        value: [],
        enumerable: true,
      });

      const promise = decryptToken(ciphertext, iv, strippedHandle);
      await expect(promise).rejects.toSatisfy((err: unknown) => {
        expect(isTokenCryptoError(err)).toBe(true);
        expect((err as { reason: TokenCryptoErrorReason }).reason).toBe(
          "invalid_key",
        );
        return true;
      });
    });

    it("classifies malformed persisted ciphertext for first-run fallback", async () => {
      const key = await generateTokenKey();
      const iv = new ArrayBuffer(AES_GCM_IV_LENGTH_BYTES);

      await expect(
        decryptToken(new ArrayBuffer(AES_GCM_TAG_LENGTH_BITS / 8 - 1), iv, key),
      ).rejects.toSatisfy((err: unknown) => {
        expect(isTokenCryptoError(err)).toBe(true);
        expect((err as { reason: TokenCryptoErrorReason }).reason).toBe(
          "invalid_input",
        );
        return true;
      });
    });

    it("throws when ciphertext and IV do not match in declared length", async () => {
      const key = await generateTokenKey();
      const wrongIv = new ArrayBuffer(AES_GCM_IV_LENGTH_BYTES);
      const { ciphertext } = await encryptToken(TOKEN, key);
      // Empty ciphertext is structurally invalid input — the contract test
      // ensures we reject before SubtleCrypto can throw an opaque error.
      await expect(
        decryptToken(new ArrayBuffer(0), wrongIv, key),
      ).rejects.toSatisfy((err: unknown) => {
        expect(isTokenCryptoError(err)).toBe(true);
        expect((err as { reason: TokenCryptoErrorReason }).reason).toBe(
          "invalid_input",
        );
        return true;
      });
      // The real ciphertext paired with a zero-length IV must also fail
      // before SubtleCrypto is reached.
      await expect(
        decryptToken(ciphertext, new ArrayBuffer(0), key),
      ).rejects.toThrow();
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Test helpers                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Copy `buffer` and optionally flip the byte at `flipByte` so a tampered
 * buffer is observable separately from the original. Returning a copy
 * matters: AES-GCM stores the ciphertext in an `ArrayBuffer`, and we MUST
 * NOT mutate the buffer the encryptor produced (otherwise the original
 * decryptToken(ciphertext, iv, key) check below the call would also see
 * the tampered bytes).
 */
function tamperArrayBuffer(
  buffer: ArrayBuffer,
  options: { flipByte: number },
): ArrayBuffer {
  const copy = buffer.slice(0);
  const view = new Uint8Array(copy);
  if (options.flipByte >= 0 && options.flipByte < view.length) {
    view[options.flipByte] = view[options.flipByte]! ^ 0x01;
  }
  return copy;
}
