// Pure half of the PII key rotation: re-encrypt one value from the old key to
// the new one and re-derive its lookup hash.
//
// Rotation is two moves that must not be split, because both halves of a PII
// field derive from the same secret:
//   * `encryptField` (AES-256-GCM) uses the HKDF "field-encryption" subkey;
//   * `lookupHash` (HMAC-SHA256) uses the HKDF "lookup-hash" subkey.
// Change the secret and a row that is re-encrypted but not re-hashed becomes
// unfindable (`phoneHash` lookups miss) and a row that is re-hashed but not
// re-encrypted becomes unreadable. `rotateCipherValue` returns both or neither.
//
// The database half lives in `scripts/pii-rotate.ts`; this module has no I/O so
// the rules are unit tested (see rotate.test.ts).

import {
  decryptField,
  encryptField,
  hashesEqual,
  isCiphertext,
  lookupHash,
} from "@/lib/privacy/crypto";

/**
 * `decryptField` deliberately *throws* on a wrong key or a malformed value —
 * a silent null would hide corruption. Rotation is the one caller that must ask
 * "can this key read it?" and treat a throw as the answer "no", so it needs a
 * quiet wrapper. Every other caller keeps the loud contract.
 */
function canRead(value: string, material: Buffer): string | null {
  try {
    return decryptField(value, material);
  } catch {
    return null;
  }
}

export type RotateOutcome =
  | { state: "rotated"; encrypted: string; hash: string }
  | { state: "already" }
  | { state: "plaintext" }
  | { state: "failed"; reason: string };

/**
 * Rotates one ciphertext.
 *
 * `already` is what makes the sweep idempotent: a row the old key cannot read
 * but the new key can was rotated by an earlier (possibly interrupted) run and
 * is left alone. A value that is not ciphertext at all is reported as
 * `plaintext` — that needs the backfill script, not the rotation script.
 */
export function rotateCipherValue(
  ciphertext: string,
  previous: Buffer,
  next: Buffer
): RotateOutcome {
  if (!isCiphertext(ciphertext)) return { state: "plaintext" };

  const plaintext = canRead(ciphertext, previous);
  if (plaintext === null) {
    if (canRead(ciphertext, next) !== null) return { state: "already" };
    return {
      state: "failed",
      reason:
        "unreadable under either key (wrong key, or a corrupt/unsupported value)",
    };
  }

  const encrypted = encryptField(plaintext, next);
  const hash = lookupHash(plaintext, next);
  if (hash === null) {
    return { state: "failed", reason: "lookup hash could not be derived" };
  }
  return { state: "rotated", encrypted, hash };
}

/** True when `ciphertext` decrypts under `material` and `hash` matches it. */
export function verifyCipherValue(
  ciphertext: string,
  hash: string | null,
  material: Buffer
): boolean {
  const plaintext = canRead(ciphertext, material);
  if (plaintext === null || hash === null) return false;
  const expected = lookupHash(plaintext, material);
  return expected !== null && hashesEqual(expected, hash);
}
