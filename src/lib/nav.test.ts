import { describe, expect, it } from "vitest";

import { activeHrefFor, navIconKey, partitionNav } from "@/lib/nav";

const items = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/reports", label: "Reports" },
  { href: "/admin/sla", label: "SLA desk" },
  { href: "/admin/audit", label: "Audit" },
  { href: "/notifications", label: "Notifications" },
];

describe("activeHrefFor", () => {
  it("prefers the longest matching href", () => {
    expect(activeHrefFor("/admin/sla", items)).toBe("/admin/sla");
    expect(activeHrefFor("/admin/sla/policies/7", items)).toBe("/admin/sla");
  });

  it("highlights the parent section for a page that has no item of its own", () => {
    expect(activeHrefFor("/admin", items)).toBe("/admin");
    // /admin/verification is not in this nav, so the section still shows as
    // active rather than leaving the whole sidebar unlit.
    expect(activeHrefFor("/admin/verification", items)).toBe("/admin");
  });

  it("never lets / swallow every page", () => {
    const publicItems = [{ href: "/", label: "Home" }];
    expect(activeHrefFor("/", publicItems)).toBe("/");
    expect(activeHrefFor("/track", publicItems)).toBeNull();
  });

  it("matches a trailing-slash-free prefix only on a segment boundary", () => {
    const audit = [{ href: "/admin/audit", label: "Audit" }];
    expect(activeHrefFor("/admin/audit-verify", audit)).toBeNull();
    expect(activeHrefFor("/admin/audit/42", audit)).toBe("/admin/audit");
  });

  it("returns null when nothing matches", () => {
    expect(activeHrefFor("/profile", items)).toBeNull();
  });
});

describe("partitionNav", () => {
  it("keeps everything visible when it already fits", () => {
    const { tabs, more } = partitionNav(items.slice(0, 4));
    expect(tabs).toHaveLength(4);
    expect(more).toHaveLength(0);
  });

  it("avoids a single orphan destination behind More", () => {
    // Five items with four tabs would hide exactly one thing; hiding two is
    // friendlier than a tab bar whose "More" holds a single link.
    const { tabs, more } = partitionNav(items.slice(0, 5));
    expect(tabs).toHaveLength(5);
    expect(more).toHaveLength(0);
  });

  it("hides the tail once a role has more destinations than fit", () => {
    const many = [
      ...items,
      { href: "/admin/users", label: "Users" },
      { href: "/admin/offices", label: "Offices" },
    ];
    const { tabs, more } = partitionNav(many);
    expect(tabs.map((item) => item.href)).toEqual([
      "/admin",
      "/admin/reports",
      "/admin/sla",
      "/admin/audit",
    ]);
    expect(more).toHaveLength(3);
  });

  it("always keeps at least one tab", () => {
    const { tabs, more } = partitionNav(items, 0);
    expect(tabs).toHaveLength(1);
    expect(more).toHaveLength(4);
  });
});

describe("navIconKey", () => {
  it("uses the deepest segment", () => {
    expect(navIconKey("/admin/sla")).toBe("sla");
    expect(navIconKey("/captain/approvals")).toBe("approvals");
  });

  it("treats the root as home", () => {
    expect(navIconKey("/")).toBe("home");
    expect(navIconKey("")).toBe("home");
  });
});
