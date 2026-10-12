// Field-level encryption for personal data (RA 10173).
//
// One secret (`PII_ENCRYPTION_KEY`) is expanded with HKDF-SHA256 into two
// independent keys:
//   * an AES-256-GCM key for encrypting field values, and
//   * an HMAC-SHA256 key for deterministic lookup hashes.
//
// The lookup hash exists so the system can find and de-duplicate records (for
// example, "has this phone number already registered?") without decrypting
// anything and without storing a plaintext copy.
//
// Key material may be given as hex (64+ chars), base64 (43+ chars) or a long
// passphrase (32+ bytes of UTF-8). Rotating the key requires re-encrypting
// every value: see docs/revamp/03-migration-plan.md.

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export const PII_KEY_ENV = "PII_ENCRYPTION_KEY";

/** Payload version marker, so the format can change without ambiguity. */
export const CIPHER_PREFIX = "v1";

const CIPHER_ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MIN_KEY_BYTES = 32;
const HKDF_SALT = "barangayresolve.pii.v1";
const HKDF_ENCRYPTION_INFO = "field-encryption";
const HKDF_LOOKUP_INFO = "lookup-hash";

export class PiiKeyMissingError extends Error {
  constructor() {
    super(
      `${PII_KEY_ENV} is not configured. Set it to a 32-byte secret (see ` +
        `.env.example) before storing personal data.`
    );
    this.name = "PiiKeyMissingError";
  }
}

export class PiiDecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PiiDecryptionError";
  }
}

type DerivedKeys = { encryption: Buffer; lookup: Buffer };

/**
 * Parses the configured secret. Hex and base64 are detected first because a
 * base64 string is also valid UTF-8 and would otherwise be used verbatim.
 */
export function parseKeyMaterial(raw: string | undefined | null): Buffer | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) {
    const decoded = Buffer.from(trimmed, "hex");
    if (decoded.length >= MIN_KEY_BYTES) return decoded;
  }

  if (/^[A-Za-z0-9+/\-_]+={0,2}$/.test(trimmed) && trimmed.length >= 43) {
    const decoded = Buffer.from(trimmed, "base64");
    if (decoded.length >= MIN_KEY_BYTES) return decoded;
  }

  const utf8 = Buffer.from(trimmed, "utf8");
  return utf8.length >= MIN_KEY_BYTES ? utf8 : null;
}

/** True when a usable key is configured on this process. */
export function hasPiiKey(): boolean {
  return readKeyMaterial() !== null;
}

export function readKeyMaterial(): Buffer | null {
  return parseKeyMaterial(process.env[PII_KEY_ENV]);
}

/** HKDF expand of the key material into the encryption and lookup keys. */
export function deriveKeys(material: Buffer): DerivedKeys {
  const encryption = Buffer.from(
    hkdfSync("sha256", material, HKDF_SALT, HKDF_ENCRYPTION_INFO, 32)
  );
  const lookup = Buffer.from(
    hkdfSync("sha256", material, HKDF_SALT, HKDF_LOOKUP_INFO, 32)
  );
  return { encryption, lookup };
}

let cached: { source: string; keys: DerivedKeys } | null = null;

function keysFor(material: Buffer): DerivedKeys {
  // Cache keyed by the material itself: reading the env on every call keeps
  // tests (and a rotated key picked up by a fresh process) correct.
  const source = material.toString("hex");
  if (cached && cached.source === source) return cached.keys;
  const keys = deriveKeys(material);
  cached = { source, keys };
  return keys;
}

/** Test helper: forget the derived keys (they are re-derived on next use). */
export function resetKeyCacheForTests(): void {
  cached = null;
}

/**
 * Encrypts a field value: `v1.<iv>.<tag>.<ciphertext>`, all base64url.
 * Throws when no key is configured — writing personal data unencrypted is
 * never a silent fallback.
 */
export function encryptField(
  plaintext: string,
  keyMaterial?: Buffer | null
): string {
  const material = keyMaterial ?? readKeyMaterial();
  if (!material) throw new PiiKeyMissingError();

  const { encryption } = keysFor(material);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(CIPHER_ALGORITHM, encryption, iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    CIPHER_PREFIX,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function isCiphertext(value: string | null | undefined): boolean {
  if (typeof value !== "string") return false;
  const parts = value.split(".");
  return parts.length === 4 && parts[0] === CIPHER_PREFIX;
}

/**
 * Decrypts a field value.
 *
 * Returns `null` only when no key is configured (the feature is not enabled on
 * this deployment). Anything that looks like ciphertext but cannot be
 * authenticated — a wrong key, a truncated value, a tampered tag — throws
 * `PiiDecryptionError`, because silently returning `null` would hide data
 * corruption behind what looks like "no phone number on file".
 */
export function decryptField(
  value: string | null | undefined,
  keyMaterial?: Buffer | null
): string | null {
  if (typeof value !== "string" || value === "") return null;

  const material = keyMaterial ?? readKeyMaterial();
  if (!material) return null;

  if (!isCiphertext(value)) {
    throw new PiiDecryptionError(
      "Stored value is not in the expected encrypted format."
    );
  }

  const [, ivPart, tagPart, dataPart] = value.split(".");
  const iv = Buffer.from(ivPart, "base64url");
  const tag = Buffer.from(tagPart, "base64url");
  const data = Buffer.from(dataPart, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new PiiDecryptionError("Encrypted value is malformed.");
  }

  const { encryption } = keysFor(material);
  const decipher = createDecipheriv(CIPHER_ALGORITHM, encryption, iv);
  decipher.setAuthTag(tag);

  try {
    return Buffer.concat([decipher.update(data), decipher.final()]).toString(
      "utf8"
    );
  } catch {
    throw new PiiDecryptionError(
      "Encrypted value failed authentication (wrong key or tampered data)."
    );
  }
}

/**
 * Deterministic keyed hash of a normalised value, used for lookups and
 * duplicate detection without decrypting. Returns `null` when no key is
 * configured, so callers must decide how to behave.
 */
export function lookupHash(
  value: string,
  keyMaterial?: Buffer | null
): string | null {
  const material = keyMaterial ?? readKeyMaterial();
  if (!material) return null;
  const { lookup } = keysFor(material);
  return createHmac("sha256", lookup).update(value, "utf8").digest("hex");
}

/** Constant-time comparison for two derived hashes. */
export function hashesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Keeps only the last `visible` characters and hides the rest. */
export function maskTail(value: string, visible = 4): string {
  const trimmed = value.trim();
  if (trimmed.length <= visible) return "•".repeat(Math.max(trimmed.length, 4));
  const hidden = trimmed.slice(0, trimmed.length - visible);
  return `${"•".repeat(hidden.length)}${trimmed.slice(-visible)}`;
}

/** Last `count` characters of a value, or null when there are not enough. */
export function tail(value: string | null | undefined, count = 4): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length < count) return trimmed === "" ? null : trimmed;
  return trimmed.slice(-count);
}
