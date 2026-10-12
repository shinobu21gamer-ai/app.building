// Phone-number persistence helpers.
//
// A phone number is never stored in the clear after the revamp:
//   phoneEncrypted - AES-256-GCM ciphertext (PII_ENCRYPTION_KEY)
//   phoneHash      - keyed HMAC for lookups and duplicate detection
//   phoneLast4     - the only part staff may see
//
// `User.phone` (plaintext) is kept during the two-phase migration only; see
// docs/revamp/03-migration-plan.md. Reads prefer the encrypted column and fall
// back to the legacy one so the switch-over needs no downtime.

import {
  decryptField,
  encryptField,
  hasPiiKey,
  lookupHash,
} from "@/lib/privacy/crypto";
import { maskPhone, normalizePhone, phoneLast4 } from "@/lib/privacy/phone";

export type PhoneFields = {
  phoneEncrypted: string;
  phoneHash: string | null;
  phoneLast4: string | null;
};

export type PhoneSourceRow = {
  phoneEncrypted?: string | null;
  phoneLast4?: string | null;
  phone?: string | null;
};

/**
 * Builds the three stored columns for a phone number.
 * Returns null when there is no usable number. Throws `PiiKeyMissingError`
 * when the deployment has no encryption key — storing a number in the clear is
 * never a silent fallback.
 */
export function buildPhoneFields(
  input: string | null | undefined
): PhoneFields | null {
  const normalized = normalizePhone(input);
  if (!normalized) return null;
  return {
    phoneEncrypted: encryptField(normalized),
    phoneHash: lookupHash(normalized),
    phoneLast4: phoneLast4(normalized),
  };
}

/** True when the deployment can store personal data at all. */
export function canStorePhone(): boolean {
  return hasPiiKey();
}

/**
 * Masked display value for a stored phone number: `+63 9••••••4567`.
 *
 * Prefers decrypting the ciphertext (the value never leaves the server
 * unmasked, so no unmasking reason is needed) and falls back to the last four
 * digits when no key is configured or the ciphertext cannot be read.
 */
export function maskedPhoneDisplay(row: PhoneSourceRow): string | null {
  if (row.phoneEncrypted) {
    try {
      const plain = decryptField(row.phoneEncrypted);
      const masked = plain ? maskPhone(plain) : null;
      if (masked) return masked;
    } catch {
      // Unreadable ciphertext falls through to the last-four fallback.
    }
  }
  if (row.phoneLast4) return `•••••••${row.phoneLast4}`;
  if (row.phone) return maskPhone(row.phone);
  return null;
}

/** Whether a stored row has any phone number at all. */
export function hasStoredPhone(row: PhoneSourceRow): boolean {
  return Boolean(row.phoneEncrypted || row.phoneLast4 || row.phone);
}

/** Legacy plaintext value, only used by read paths that predate the switch. */
export function legacyPlaintextPhone(row: PhoneSourceRow): string | null {
  return row.phone ? normalizePhone(row.phone) : null;
}

/**
 * Full number for an authorised unmasking: decrypts the encrypted column and
 * falls back to the legacy plaintext column before it is dropped.
 */
export function readablePhone(row: PhoneSourceRow): string | null {
  if (row.phoneEncrypted) return decryptField(row.phoneEncrypted);
  return legacyPlaintextPhone(row);
}
