import { describe, expect, it } from "vitest";
import { copy } from "@/lib/i18n";
import { partitionNav } from "@/lib/nav";
import {
  adminNavItems,
  captainNavItems,
  officialNavItems,
  treasuryNavItems,
} from "./portal-nav";

describe("adminNavItems", () => {
  it("puts the desks admin uses on a case in the phone tabs", () => {
    const items = adminNavItems(copy.en);
    const { tabs } = partitionNav(items);
    expect(tabs.map((item) => item.href)).toEqual([
      "/admin",
      "/admin/validation",
      "/admin/field-checks",
      "/admin/verification",
    ]);
  });

  it("groups the long menu so setup is not mixed with today's work", () => {
    const items = adminNavItems(copy.en);
    expect(items.find((item) => item.href === "/admin/validation")?.section).toBe(
      copy.en.admin.navSectionWork
    );
    expect(items.find((item) => item.href === "/admin/settings")?.section).toBe(
      copy.en.admin.navSectionHall
    );
    expect(items.find((item) => item.href === "/admin/security-reports")?.label)
      .toBe("Sign-in reports");
    expect(adminNavItems(copy.fil).find((item) => item.href === "/admin/security-reports")?.label)
      .toBe("Mga ulat sa sign-in");
  });
});

describe("plain-language finance and oversight navigation", () => {
  it("keeps the treasury record and payment destinations explicit in English and Filipino", () => {
    const english = treasuryNavItems(copy.en);
    const filipino = treasuryNavItems(copy.fil);
    expect(english.find((item) => item.href === "/treasury/disbursements")?.label).toBe("Payment vouchers");
    expect(english.find((item) => item.href === "/treasury/ledger")?.label).toBe("Money ledger");
    expect(english.find((item) => item.href === "/treasury/earmarks")?.label).toBe("Reserved funds (earmarks)");
    expect(filipino.find((item) => item.href === "/treasury/ledger")?.label).toBe("Talaan ng galaw ng pondo");
    expect(filipino.find((item) => item.href === "/treasury/earmarks")?.label).toBe("Pondong itinabi (earmark)");
  });

  it("uses action/outcome wording for the captain's late-case desk", () => {
    const item = captainNavItems(copy.en).find((nav) => nav.href === "/captain/escalations");
    expect(item?.label).toBe("Overdue cases");
    expect(captainNavItems(copy.fil).find((nav) => nav.href === "/captain/escalations")?.label)
      .toBe("Mga kasong lampas sa takdang oras");
    expect(captainNavItems(copy.en).find((nav) => nav.href === "/captain/approvals")?.label)
      .toBe("Money approvals");
  });

  it("labels case and admin work as tasks in both locales", () => {
    expect(officialNavItems(copy.en).find((item) => item.href === "/official/concerns")?.label)
      .toBe("Cases");
    expect(adminNavItems(copy.en).find((item) => item.href === "/admin/field-checks")?.label)
      .toBe("On-site checks");
    expect(adminNavItems(copy.fil).find((item) => item.href === "/admin/validation")?.label)
      .toBe("Suriin at italaga ang mga kaso");
    expect(adminNavItems(copy.fil).find((item) => item.href === "/admin/routing")?.label)
      .toBe("Pagtatalaga ng opisina");
  });
});
