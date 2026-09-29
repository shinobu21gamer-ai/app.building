import { describe, expect, it } from "vitest";
import { registerSchema, resetPasswordSchema } from "./auth";

describe("registerSchema", () => {
  it("normalizes and validates a valid registration", () => {
    const result = registerSchema.safeParse({
      email: "  RESIDENT@EXAMPLE.COM ",
      password: "StrongPass1",
      firstName: "Ana",
      lastName: "Santos",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("resident@example.com");
    }
  });

  it("enforces the password policy", () => {
    for (const password of [
      "short1A", // too short
      "lowercaseonly1",
      "UPPERCASEONLY1",
      "NoDigitsHere",
    ]) {
      expect(
        registerSchema.safeParse({
          email: "a@b.com",
          password,
          firstName: "Ana",
          lastName: "Santos",
        }).success
      ).toBe(false);
    }
  });

  it("rejects invalid emails and short names", () => {
    expect(
      registerSchema.safeParse({
        email: "not-an-email",
        password: "StrongPass1",
        firstName: "Ana",
        lastName: "Santos",
      }).success
    ).toBe(false);
    expect(
      registerSchema.safeParse({
        email: "a@b.com",
        password: "StrongPass1",
        firstName: "A",
        lastName: "Santos",
      }).success
    ).toBe(false);
  });
});

describe("resetPasswordSchema", () => {
  const valid = {
    email: "resident@example.com",
    code: "8F2C41D77E3A09B5",
    newPassword: "BetterPass2",
  };

  it("accepts a valid code and password", () => {
    expect(resetPasswordSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects codes that are too short or too long", () => {
    expect(
      resetPasswordSchema.safeParse({ ...valid, code: "ABC" }).success
    ).toBe(false);
    expect(
      resetPasswordSchema.safeParse({
        ...valid,
        code: "8F2C41D77E3A09B5EXTRA",
      }).success
    ).toBe(false);
  });

  it("rejects weak new passwords", () => {
    expect(
      resetPasswordSchema.safeParse({ ...valid, newPassword: "weak" }).success
    ).toBe(false);
  });
});