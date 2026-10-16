import { describe, expect, it } from "vitest";
import { copy } from "@/lib/i18n";
import { partitionNav } from "@/lib/nav";
import { adminNavItems } from "./portal-nav";

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
  });
});
