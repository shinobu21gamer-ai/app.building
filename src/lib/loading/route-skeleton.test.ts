import { describe, expect, it } from "vitest";
import {
  hasRoleNav,
  normalizePathname,
  routeKeyFor,
  routeSkeletonVariant,
} from "./route-skeleton";

describe("normalizePathname", () => {
  it("drops trailing slashes, query strings and hashes", () => {
    expect(normalizePathname("/help/")).toBe("/help");
    expect(normalizePathname("/track?ref=BR-1#top")).toBe("/track");
    expect(normalizePathname("/resident///")).toBe("/resident");
  });

  it("keeps the root path", () => {
    expect(normalizePathname("/")).toBe("/");
    expect(normalizePathname("")).toBe("/");
  });
});

describe("routeKeyFor", () => {
  it("treats trailing slashes and equivalent query encodings as the same page", () => {
    expect(routeKeyFor("/official/concerns/", "?q=a%20b")).toBe(
      routeKeyFor("/official/concerns", "?q=a+b")
    );
  });

  it("includes the query only when there is one", () => {
    expect(routeKeyFor("/admin/users", "")).toBe("/admin/users");
    expect(routeKeyFor("/admin/users", "?status=ACTIVE")).toBe(
      "/admin/users?status=ACTIVE"
    );
  });

  it("separates different filters on the same path", () => {
    expect(routeKeyFor("/official/concerns", "?status=A")).not.toBe(
      routeKeyFor("/official/concerns", "?status=B")
    );
  });
});

describe("hasRoleNav", () => {
  it("is true for every role area, including nested pages", () => {
    expect(hasRoleNav("/resident")).toBe(true);
    expect(hasRoleNav("/resident/concerns/12/print")).toBe(true);
    expect(hasRoleNav("/official/concerns")).toBe(true);
    expect(hasRoleNav("/admin/users")).toBe(true);
  });

  it("is false for public and shared pages, and for look-alike prefixes", () => {
    expect(hasRoleNav("/")).toBe(false);
    expect(hasRoleNav("/notifications")).toBe(false);
    expect(hasRoleNav("/residential")).toBe(false);
    expect(hasRoleNav("/administrators")).toBe(false);
  });
});

describe("routeSkeletonVariant", () => {
  it("maps the landing page and reading pages", () => {
    expect(routeSkeletonVariant("/")).toBe("landing");
    expect(routeSkeletonVariant("/help")).toBe("article");
    expect(routeSkeletonVariant("/privacy/")).toBe("article");
  });

  it("maps authentication pages", () => {
    expect(routeSkeletonVariant("/login")).toBe("auth");
    expect(routeSkeletonVariant("/reset-password")).toBe("auth");
    expect(routeSkeletonVariant("/register")).toBe("form");
  });

  it("maps dashboards and lists", () => {
    expect(routeSkeletonVariant("/resident")).toBe("dashboard");
    expect(routeSkeletonVariant("/official")).toBe("dashboard");
    expect(routeSkeletonVariant("/admin")).toBe("dashboard");
    expect(routeSkeletonVariant("/resident/concerns")).toBe("list");
    expect(routeSkeletonVariant("/official/concerns")).toBe("list");
    expect(routeSkeletonVariant("/notifications")).toBe("list");
  });

  it("maps case detail pages, including their print views", () => {
    expect(routeSkeletonVariant("/resident/concerns/42")).toBe("detail");
    expect(routeSkeletonVariant("/official/concerns/42/print")).toBe("detail");
  });

  it("maps the concern submission form before the detail route", () => {
    expect(routeSkeletonVariant("/resident/concerns/new")).toBe("form");
  });

  it("maps admin management pages to tables, and the config pages to forms", () => {
    expect(routeSkeletonVariant("/admin/users")).toBe("table");
    expect(routeSkeletonVariant("/admin/routing")).toBe("table");
    expect(routeSkeletonVariant("/admin/priority")).toBe("form");
    expect(routeSkeletonVariant("/admin/settings")).toBe("form");
  });

  it("falls back to a generic shape for unknown routes", () => {
    expect(routeSkeletonVariant("/something-else")).toBe("default");
  });
});
