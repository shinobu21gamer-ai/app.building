import { describe, expect, it } from "vitest";
import {
  isNormalizedPhone,
  maskPhone,
  normalizePhone,
  phoneDigits,
  phoneLast4,
} from "./phone";

describe("normalizePhone", () => {
  it("accepts every shape people type", () => {
    for (const input of [
      "+639171234567",
      "+63 917 123 4567",
      "639171234567",
      "09171234567",
      "0917 123 4567",
      "0917-123-4567",
      "(0917) 123-4567",
      "9171234567",
    ]) {
      expect(normalizePhone(input)).toBe("+639171234567");
    }
  });

  it("rejects landlines, which cannot receive case updates", () => {
    expect(normalizePhone("0288765432")).toBeNull();
    expect(normalizePhone("(02) 8876-5432")).toBeNull();
    expect(normalizePhone("+63288765432")).toBeNull();
  });

  it("rejects values that cannot be a Philippine number", () => {
    for (const input of [
      "",
      "   ",
      "12345",
      "091712345", // 9 digits
      "0917123456789", // 13 digits
      "+14155552671", // US number
      "not a phone",
      "+9909171234567",
    ]) {
      expect(normalizePhone(input)).toBeNull();
    }
  });

  it("rejects a national number that starts with 0 after the trunk prefix", () => {
    expect(normalizePhone("00000000000")).toBeNull();
  });

  it("handles null and undefined", () => {
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
  });
});

describe("isNormalizedPhone", () => {
  it("accepts only the canonical shape", () => {
    expect(isNormalizedPhone("+639171234567")).toBe(true);
    expect(isNormalizedPhone("09171234567")).toBe(false);
    expect(isNormalizedPhone(null)).toBe(false);
  });
});

describe("maskPhone", () => {
  it("never reveals more than the last four digits", () => {
    const masked = maskPhone("+639171234567");
    expect(masked).toBe("+63 9••••••4567");
    expect(masked).not.toContain("1712");
  });

  it("masks unnormalised input instead of returning it untouched", () => {
    const masked = maskPhone("(0917) 123-4567");
    expect(masked).toBe("+63 9••••••4567");
  });

  it("masks values that are not phone numbers instead of echoing them", () => {
    expect(maskPhone("internal-ext-4412")).toBe("••••4412");
    expect(maskPhone("1234")).toBe("••••");
    expect(maskPhone("")).toBeNull();
    expect(maskPhone(null)).toBeNull();
  });

  it("masks a landline with the plain fallback", () => {
    expect(maskPhone("0288765432")).toBe("••••5432");
  });
});

describe("phoneLast4 / phoneDigits", () => {
  it("returns the last four digits of any accepted shape", () => {
    expect(phoneLast4("0917 123 4567")).toBe("4567");
    expect(phoneLast4("+639171234567")).toBe("4567");
    expect(phoneLast4(null)).toBeNull();
  });

  it("extracts digits for search inputs", () => {
    expect(phoneDigits("0917 123 4567")).toBe("09171234567");
    expect(phoneDigits(null)).toBe("");
  });
});
