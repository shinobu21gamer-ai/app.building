import { describe, expect, it } from "vitest";
import { fiscalYearCreateSchema } from "./treasury";
import { reassignSchema } from "./routing";
import { slaPolicySaveSchema } from "./sla";
import { registerSchema } from "./auth";
import { officeCreateSchema } from "./admin";

const nextYear = new Date().getUTCFullYear() + 1;
const fiscalYear = {
  year: nextYear,
  startsOn: `${nextYear}-01-01`,
  endsOn: `${nextYear}-12-31`,
};

describe("optional fields from HTML and JSON forms", () => {
  it.each([undefined, null, "", "   "])("allows a blank fiscal-year name: %s", (name) => {
    const result = fiscalYearCreateSchema.safeParse({ ...fiscalYear, name });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.name).toBeUndefined();
  });

  it("still validates non-empty optional names", () => {
    expect(fiscalYearCreateSchema.safeParse({ ...fiscalYear, name: "a".repeat(81) }).success).toBe(false);
    expect(fiscalYearCreateSchema.safeParse({ ...fiscalYear, name: 123 }).success).toBe(false);
  });

  it.each([undefined, null, "", "   "])("does not require a specific official: %s", (officialId) => {
    expect(reassignSchema.safeParse({ officeId: 1, reason: "Route to this office", officialId }).success).toBe(true);
  });

  it("still rejects invalid selected officials and missing assignment reason", () => {
    expect(reassignSchema.safeParse({ officeId: 1, officialId: "-1", reason: "Route to this office" }).success).toBe(false);
    expect(reassignSchema.safeParse({ officeId: 1, officialId: "", reason: "" }).success).toBe(false);
  });

  it.each([undefined, null, "", "   "])("allows a stage-wide SLA without a service type: %s", (typeId) => {
    expect(slaPolicySaveSchema.safeParse({
      key: "assessment.default", name: "Default assessment", stage: "UNDER_ASSESSMENT",
      hours: 24, escalateToRole: "ADMIN", typeId,
    }).success).toBe(true);
  });

  it("keeps phone and address genuinely optional at registration", () => {
    expect(registerSchema.safeParse({
      email: "resident@example.com", password: "Password123", firstName: "Juan", lastName: "Cruz",
      phone: "", address: "", consentDataProcessing: true, consentPrivacyNotice: true,
    }).success).toBe(true);
  });

  it("does not turn mandatory office contact into an optional field", () => {
    expect(officeCreateSchema.safeParse({ name: "Office", code: "INFRA", contact: "" }).success).toBe(false);
  });
});
