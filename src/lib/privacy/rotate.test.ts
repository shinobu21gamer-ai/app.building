import { describe, expect, it } from "vitest";

import {
  decryptField,
  encryptField,
  lookupHash,
  parseKeyMaterial,
} from "@/lib/privacy/crypto";
import { rotateCipherValue, verifyCipherValue } from "@/lib/privacy/rotate";

const KEY_A = parseKeyMaterial("a".repeat(48));
const KEY_B = parseKeyMaterial("b".repeat(48));
if (!KEY_A || !KEY_B) throw new Error("test keys must parse");

describe("rotateCipherValue", () => {
  it("re-encrypts under the new key and re-derives the lookup hash", () => {
    const phone = "+639171234567";
    const oldCipher = encryptField(phone, KEY_A);
    const oldHash = lookupHash(phone, KEY_A);

    const outcome = rotateCipherValue(oldCipher, KEY_A, KEY_B);
    expect(outcome.state).toBe("rotated");
    if (outcome.state !== "rotated") return;

    expect(decryptField(outcome.encrypted, KEY_B)).toBe(phone);
    expect(outcome.encrypted).not.toBe(oldCipher);
    expect(outcome.hash).not.toBe(oldHash);
    expect(outcome.hash).toBe(lookupHash(phone, KEY_B));
  });

  it("stays readable under the old key until the row is written", () => {
    const cipher = encryptField("0917 123 4567", KEY_A);
    const outcome = rotateCipherValue(cipher, KEY_A, KEY_B);
    expect(outcome.state).toBe("rotated");
    // The caller writes the rotated value; nothing in this module mutates the
    // input, so the old ciphertext is still intact until then.
    expect(decryptField(cipher, KEY_A)).toBe("0917 123 4567");
  });

  it("reports a row already on the new key as 'already' (idempotent re-runs)", () => {
    const onNewKey = encryptField("+639171234567", KEY_B);
    expect(rotateCipherValue(onNewKey, KEY_A, KEY_B)).toEqual({
      state: "already",
    });
  });

  it("reports a plaintext row as 'plaintext' rather than guessing", () => {
    expect(rotateCipherValue("+639171234567", KEY_A, KEY_B)).toEqual({
      state: "plaintext",
    });
    expect(rotateCipherValue("0917 123 4567", KEY_A, KEY_B)).toEqual({
      state: "plaintext",
    });
  });

  it("fails a value that is shaped like ciphertext but cannot be read", () => {
    // `v1.<iv>.<tag>.<data>` with an iv of the wrong length: it passes the shape
    // check, so the honest answer is a failure, never "plaintext".
    const outcome = rotateCipherValue("v1.only.three.parts", KEY_A, KEY_B);
    expect(outcome.state).toBe("failed");
    if (outcome.state !== "failed") return;
    expect(outcome.reason).toContain("unreadable");
  });

  it("fails loudly when neither key can read the value", () => {
    const other = parseKeyMaterial("c".repeat(48));
    if (!other) throw new Error("test key must parse");
    const cipher = encryptField("+639171234567", other);

    const outcome = rotateCipherValue(cipher, KEY_A, KEY_B);
    expect(outcome.state).toBe("failed");
    if (outcome.state !== "failed") return;
    expect(outcome.reason).toContain("unreadable");
  });

  it("rotates a value of any length without truncating it", () => {
    const idNumber = "1234-5678-9012-3456";
    const outcome = rotateCipherValue(encryptField(idNumber, KEY_A), KEY_A, KEY_B);
    expect(outcome.state).toBe("rotated");
    if (outcome.state !== "rotated") return;
    expect(decryptField(outcome.encrypted, KEY_B)).toBe(idNumber);
  });
});

describe("verifyCipherValue", () => {
  it("accepts a row rotated to the new key", () => {
    const phone = "+639171234567";
    const outcome = rotateCipherValue(encryptField(phone, KEY_A), KEY_A, KEY_B);
    if (outcome.state !== "rotated") throw new Error("expected a rotation");

    expect(verifyCipherValue(outcome.encrypted, outcome.hash, KEY_B)).toBe(true);
  });

  it("rejects a row that is still on the old key", () => {
    const cipher = encryptField("+639171234567", KEY_A);
    expect(verifyCipherValue(cipher, lookupHash("+639171234567", KEY_A), KEY_B)).toBe(
      false
    );
  });

  it("rejects a row whose hash no longer matches its value", () => {
    const outcome = rotateCipherValue(
      encryptField("+639171234567", KEY_A),
      KEY_A,
      KEY_B
    );
    if (outcome.state !== "rotated") throw new Error("expected a rotation");

    const wrongHash = lookupHash("+639170000000", KEY_B);
    expect(verifyCipherValue(outcome.encrypted, wrongHash, KEY_B)).toBe(false);
    expect(verifyCipherValue(outcome.encrypted, null, KEY_B)).toBe(false);
  });
});
