import { describe, expect, it } from "vitest";
import { caseReturnHref } from "./return-to";

describe("caseReturnHref", () => {
  it("preserves an official's filtered queue", () => {
    expect(caseReturnHref(
      "OFFICIAL",
      "/official/concerns?status=IN_PROGRESS&page=2",
    )).toBe("/official/concerns?status=IN_PROGRESS&page=2");
  });

  it("keeps special-role links on the desk that opened the case", () => {
    expect(caseReturnHref("CAPTAIN", "/captain/closure")).toBe("/captain/closure");
    expect(caseReturnHref("TREASURER", "/treasury/disbursements#crew-payment-requests"))
      .toBe("/treasury/disbursements#crew-payment-requests");
  });

  it("rejects external, malformed, and out-of-role destinations", () => {
    expect(caseReturnHref("OFFICIAL", "https://evil.example/"))
      .toBe("/official/concerns");
    expect(caseReturnHref("OFFICIAL", "//evil.example/"))
      .toBe("/official/concerns");
    expect(caseReturnHref("OFFICIAL", "/captain/closure"))
      .toBe("/official/concerns");
    expect(caseReturnHref("ADMIN", "/admin/users"))
      .toBe("/admin/validation");
  });

  it("uses the role's safe desk when there is no return path", () => {
    expect(caseReturnHref("ADMIN", null)).toBe("/admin/validation");
    expect(caseReturnHref("CAPTAIN", ["/captain/approvals", "/captain"]))
      .toBe("/captain/approvals");
  });
});
