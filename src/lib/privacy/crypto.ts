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

/** Shell command that prints a fresh, valid key (see `.env.example`). */
export const PII_KEY_GENERATE_COMMAND =
  "node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"";

/**
 * Why the configured secret cannot be used.
 *
 * `missing` and `too_short`/`placeholder` are kept apart on purpose: a
 * deployment that pasted the `.env.example` placeholder into its environment
 * *does* have `PII_ENCRYPTION_KEY` set, so telling the operator "no key
 * configured" sends them looking in the wrong place.
 */
export type PiiKeyProblem = "missing" | "too_short" | "placeholder";

export type PiiKeyStatus =
  | { ready: true; byteLength: number }
  | { ready: false; problem: PiiKeyProblem; byteLength: number };

/**
 * Values that mean "nobody replaced the documented placeholder". Matched as
 * case-insensitive substrings; the secret itself is never echoed back.
 */
const PLACEHOLDER_MARKERS = [
  "replace-with",
  "only-during-a-rotation",
  "change-me",
  "changeme",
] as const;

/** Operator-facing explanation of a missing or unusable key (never leaks it). */
export function piiKeyProblemMessage(status: PiiKeyStatus): string {
  if (status.ready) {
    return `${PII_KEY_ENV} is configured.`;
  }
  switch (status.problem) {
    case "too_short":
      return (
        `${PII_KEY_ENV} is set but unusable: it holds ${status.byteLength} bytes ` +
        `and at least ${MIN_KEY_BYTES} bytes are required (43+ base64 characters, ` +
        `64 hex characters, or a 32+ byte passphrase). Generate one with: ` +
        `${PII_KEY_GENERATE_COMMAND}`
      );
    case "placeholder":
      return (
        `${PII_KEY_ENV} is set but still holds the example placeholder, which is ` +
        `public — replace it with a real secret before storing personal data. ` +
        `Generate one with: ${PII_KEY_GENERATE_COMMAND}`
      );
    default:
      return (
        `${PII_KEY_ENV} is not set on this deployment, so personal data cannot be ` +
        `stored safely. Generate a secret with: ${PII_KEY_GENERATE_COMMAND} ` +
        `then set it in the environment (for Vercel: Project Settings > ` +
        `Environment Variables) and redeploy.`
      );
  }
}

export class PiiKeyMissingError extends Error {
  constructor(status: PiiKeyStatus = piiKeyStatus()) {
    super(
      `${piiKeyProblemMessage(status)} Personal data is not stored unencrypted, ` +
        `so this action cannot be completed.`
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
 *
 * Values that are *known* to be placeholders (the ones `.env.example` ships)
 * are rejected even when they are long enough to derive a key: encrypting
 * personal data under a string published in the repository is worse than
 * refusing to store it.
 */
export function parseKeyMaterial(raw: string | undefined | null): Buffer | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (looksLikePlaceholder(trimmed)) return null;

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

function looksLikePlaceholder(trimmed: string): boolean {
  const lower = trimmed.toLowerCase();
  return PLACEHOLDER_MARKERS.some((marker) => lower.includes(marker));
}

/**
 * Diagnostic view of the configured key for pages, API errors and operators.
 * Reports *why* a key is unusable (unset vs. too short vs. the documented
 * placeholder) without ever echoing the secret.
 */
export function piiKeyStatus(): PiiKeyStatus {
  const raw = process.env[PII_KEY_ENV];
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  const material = parseKeyMaterial(raw);
  if (material) return { ready: true, byteLength: material.length };

  const problem: PiiKeyProblem =
    trimmed === ""
      ? "missing"
      : looksLikePlaceholder(trimmed)
        ? "placeholder"
        : "too_short";
  return {
    ready: false,
    problem,
    byteLength: Buffer.byteLength(trimmed, "utf8"),
  };
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
