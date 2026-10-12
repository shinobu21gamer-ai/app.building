import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PII_KEY_ENV,
  PiiDecryptionError,
  PiiKeyMissingError,
  decryptField,
  deriveKeys,
  encryptField,
  hashesEqual,
  hasPiiKey,
  isCiphertext,
  lookupHash,
  maskTail,
  parseKeyMaterial,
  resetKeyCacheForTests,
  tail,
} from "./crypto";

// A deterministic 32-byte test key (base64) — never a real deployment secret.
const TEST_KEY = Buffer.alloc(32, 7).toString("base64");
const OTHER_KEY = Buffer.alloc(32, 9).toString("base64");

const original = process.env[PII_KEY_ENV];

beforeEach(() => {
  process.env[PII_KEY_ENV] = TEST_KEY;
  resetKeyCacheForTests();
});

afterEach(() => {
  if (original === undefined) delete process.env[PII_KEY_ENV];
  else process.env[PII_KEY_ENV] = original;
  resetKeyCacheForTests();
});

describe("key material", () => {
  it("accepts base64, hex and long passphrases", () => {
    expect(parseKeyMaterial(TEST_KEY)?.length).toBe(32);
    expect(parseKeyMaterial("a".repeat(64))?.length).toBe(32);
    expect(parseKeyMaterial("passphrase-with-plenty-of-characters")?.length).toBe(
      "passphrase-with-plenty-of-characters".length
    );
  });

  it("rejects missing, empty and too-short secrets", () => {
    expect(parseKeyMaterial(undefined)).toBeNull();
    expect(parseKeyMaterial("")).toBeNull();
    expect(parseKeyMaterial("too-short")).toBeNull();
  });

  it("derives independent encryption and lookup keys", () => {
    const material = parseKeyMaterial(TEST_KEY)!;
    const keys = deriveKeys(material);
    expect(keys.encryption.length).toBe(32);
    expect(keys.lookup.length).toBe(32);
    expect(keys.encryption.equals(keys.lookup)).toBe(false);
  });
});

describe("encryptField / decryptField", () => {
  it("round-trips a value", () => {
    const ciphertext = encryptField("+639171234567");
    expect(ciphertext.startsWith("v1.")).toBe(true);
    expect(ciphertext).not.toContain("9171234567");
    expect(decryptField(ciphertext)).toBe("+639171234567");
  });

  it("round-trips unicode and long values", () => {
    const value = "Peñaflor ✓ " + "x".repeat(500);
    expect(decryptField(encryptField(value))).toBe(value);
  });

  it("uses a fresh IV every time", () => {
    const a = encryptField("same-value");
    const b = encryptField("same-value");
    expect(a).not.toBe(b);
    expect(decryptField(a)).toBe("same-value");
    expect(decryptField(b)).toBe("same-value");
  });

  it("fails loudly on tampering instead of returning null", () => {
    const ciphertext = encryptField("09171234567");
    const parts = ciphertext.split(".");
    const tampered = [parts[0], parts[1], parts[2], "AAAA" + parts[3].slice(4)].join(
      "."
    );
    expect(() => decryptField(tampered)).toThrow(PiiDecryptionError);
    expect(() => decryptField("v1.zzzz.zzzz.zzzz")).toThrow(PiiDecryptionError);
  });

  it("cannot read another deployment's ciphertext", () => {
    const ciphertext = encryptField("09171234567", parseKeyMaterial(OTHER_KEY)!);
    expect(() => decryptField(ciphertext, parseKeyMaterial(TEST_KEY)!)).toThrow(
      PiiDecryptionError
    );
  });

  it("treats an empty stored value as 'nothing on file'", () => {
    expect(decryptField(null)).toBeNull();
    expect(decryptField("")).toBeNull();
  });

  it("refuses to encrypt with no key configured", () => {
    delete process.env[PII_KEY_ENV];
    resetKeyCacheForTests();
    expect(hasPiiKey()).toBe(false);
    expect(() => encryptField("09171234567")).toThrow(PiiKeyMissingError);
    // Decryption degrades instead: the feature is simply not enabled.
    expect(decryptField("v1.a.b.c")).toBeNull();
  });
});

describe("lookupHash", () => {
  it("is deterministic, keyed and value-specific", () => {
    const first = lookupHash("+639171234567");
    const second = lookupHash("+639171234567");
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(lookupHash("+639171234568")).not.toBe(first);
    expect(lookupHash("+639171234567", parseKeyMaterial(OTHER_KEY)!)).not.toBe(
      first
    );
  });

  it("returns null without a key so callers must decide explicitly", () => {
    delete process.env[PII_KEY_ENV];
    resetKeyCacheForTests();
    expect(lookupHash("+639171234567")).toBeNull();
  });

  it("compares hashes without throwing on different lengths", () => {
    expect(hashesEqual("abc", "abc")).toBe(true);
    expect(hashesEqual("abc", "abcd")).toBe(false);
    expect(hashesEqual("abc", "abd")).toBe(false);
  });
});

describe("masking helpers", () => {
  it("hides everything but the last characters", () => {
    expect(maskTail("+639171234567", 4)).toBe("•••••••••4567");
    expect(maskTail("1234", 4)).toBe("••••");
    // Short values are never revealed at all.
    expect(maskTail("12", 4)).toBe("••••");
  });

  it("returns the tail or null", () => {
    expect(tail("+639171234567", 4)).toBe("4567");
    expect(tail(null)).toBeNull();
    expect(tail("", 4)).toBeNull();
    expect(tail("ab", 4)).toBe("ab");
  });

  it("recognises ciphertext shape", () => {
    expect(isCiphertext(encryptField("x"))).toBe(true);
    expect(isCiphertext("+639171234567")).toBe(false);
    expect(isCiphertext(null)).toBe(false);
  });
});
