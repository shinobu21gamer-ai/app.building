import { describe, expect, it } from "vitest";
import { registerSchema, resetPasswordSchema, updateProfileSchema } from "./auth";

/** The two acknowledgements RA 10173 requires before an account is created. */
const consents = {
  consentDataProcessing: true,
  consentPrivacyNotice: true,
};

describe("registerSchema", () => {
  it("normalizes and validates a valid registration", () => {
    const result = registerSchema.safeParse({
      email: "  RESIDENT@EXAMPLE.COM ",
      password: "StrongPass1",
      firstName: "Ana",
      lastName: "Santos",
      ...consents,
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
          ...consents,
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
        ...consents,
      }).success
    ).toBe(false);
    expect(
      registerSchema.safeParse({
        email: "a@b.com",
        password: "StrongPass1",
        firstName: "A",
        lastName: "Santos",
        ...consents,
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
describe("registration consents and phone number", () => {
  const base = {
    email: "ana@example.com",
    password: "StrongPass1",
    firstName: "Ana",
    lastName: "Santos",
  };

  it("requires both mandatory acknowledgements", () => {
    expect(registerSchema.safeParse(base).success).toBe(false);
    expect(
      registerSchema.safeParse({ ...base, ...consents, consentPrivacyNotice: false })
        .success
    ).toBe(false);
    expect(
      registerSchema.safeParse({ ...base, ...consents, consentDataProcessing: false })
        .success
    ).toBe(false);
    expect(registerSchema.safeParse({ ...base, ...consents }).success).toBe(true);
  });

  it("does not accept the string \"false\" as agreement", () => {
    expect(
      registerSchema.safeParse({
        ...base,
        ...consents,
        consentDataProcessing: "false",
      }).success
    ).toBe(false);
  });

  it("normalises a Philippine phone number to +63", () => {
    const result = registerSchema.safeParse({
      ...base,
      ...consents,
      phone: "0917 123 4567",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.phone).toBe("+639171234567");
  });

  it("treats an empty phone as no number at all", () => {
    const result = registerSchema.safeParse({ ...base, ...consents, phone: "" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.phone).toBeNull();
  });

  it("rejects a phone number that cannot be Philippine", () => {
    expect(
      registerSchema.safeParse({ ...base, ...consents, phone: "+14155552671" })
        .success
    ).toBe(false);
  });
});

describe("updateProfileSchema", () => {
  it("leaves the number alone when the field is omitted", () => {
    const result = updateProfileSchema.safeParse({ firstName: "Ana" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("phone");
  });

  it("normalises a newly typed number", () => {
    const result = updateProfileSchema.safeParse({ phone: "917 123 4567" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.phone).toBe("+639171234567");
  });

  it("reads an empty string as 'remove my number'", () => {
    const result = updateProfileSchema.safeParse({ phone: "" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.phone).toBeNull();
  });

  it("refuses a masked value echoed back by a stale form", () => {
    expect(
      updateProfileSchema.safeParse({ phone: "+63 9••••••4567" }).success
    ).toBe(false);
  });

  it("still requires at least one field", () => {
    expect(updateProfileSchema.safeParse({}).success).toBe(false);
  });
});
