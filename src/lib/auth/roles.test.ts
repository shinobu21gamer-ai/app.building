import { describe, expect, it } from "vitest";

import {
  CASE_SHEET_ROLES,
  PORTAL_GUARDS,
  ROLE_KEYS,
  canOpenPath,
  sharedRouteRoles,
  type RoleKey,
} from "./roles";

describe("sharedRouteRoles", () => {
  it("names the Captain for the case sheet, sub-pages included", () => {
    expect(sharedRouteRoles("/official/concerns/42")).toEqual([
      "CAPTAIN",
      "TREASURER",
    ]);
    expect(sharedRouteRoles("/official/concerns/42/assessment")).toEqual([
      "CAPTAIN",
      "TREASURER",
    ]);
  });

  it("keeps the office's own queue to the office", () => {
    // The trailing slash in the table is the whole point: `/official/concerns`
    // is the office's case queue, and the Captain has no business in it.
    expect(sharedRouteRoles("/official/concerns")).toEqual([]);
  });

  it("shares nothing outside the case sheet", () => {
    expect(sharedRouteRoles("/official")).toEqual([]);
    expect(sharedRouteRoles("/official/reports")).toEqual([]);
    // A sibling path that merely starts with the same letters is not the sheet.
    expect(sharedRouteRoles("/official/concerns-old/42")).toEqual([]);
    expect(sharedRouteRoles("/captain")).toEqual([]);
    expect(sharedRouteRoles("/notifications")).toEqual([]);
  });
});

describe("canOpenPath", () => {
  it("lets the Captain open the case sheet they verify and close from", () => {
    expect(canOpenPath("CAPTAIN", "/official/concerns/42")).toBe(true);
    expect(canOpenPath("CAPTAIN", "/captain/closure")).toBe(true);
  });

  it("still sends the Captain away from the office's own desks", () => {
    expect(canOpenPath("CAPTAIN", "/official")).toBe(false);
    expect(canOpenPath("CAPTAIN", "/official/concerns")).toBe(false);
    expect(canOpenPath("CAPTAIN", "/official/reports")).toBe(false);
  });

  it("does not open the case sheet to anyone else", () => {
    expect([...CASE_SHEET_ROLES]).toEqual([
      "OFFICIAL",
      "ADMIN",
      "CAPTAIN",
      "TREASURER",
    ]);
    expect(canOpenPath("TREASURER", "/official/concerns/42")).toBe(true);
    expect(canOpenPath("TREASURER", "/official/concerns")).toBe(false);
    expect(canOpenPath("TREASURER", "/official")).toBe(false);
  });

  it("admits to the sheet exactly the roles the sheet itself admits", () => {
    // The page behind this route guards with `CASE_SHEET_ROLES`. If the two
    // ever disagree, one of them is wrong, and the reader pays for it: a role
    // the guard waves through is turned away by the page, and a role the page
    // accepts is bounced at the portal before it can open a single case — which
    // is how the Captain, who verifies and closes cases on this sheet, could
    // not open one at all.
    for (const roleKey of ROLE_KEYS) {
      expect(canOpenPath(roleKey, "/official/concerns/42")).toBe(
        (CASE_SHEET_ROLES as readonly string[]).includes(roleKey)
      );
    }
  });

  it("gives every portal its own roles, and only them", () => {
    const portalRole: Record<string, RoleKey> = {
      "/admin": "ADMIN",
      "/official": "OFFICIAL",
      "/resident": "RESIDENT",
      "/treasury": "TREASURER",
      "/captain": "CAPTAIN",
      "/crew": "CREW",
    };
    for (const guard of PORTAL_GUARDS) {
      const home = portalRole[guard.prefix];
      for (const roleKey of ROLE_KEYS) {
        expect(canOpenPath(roleKey, guard.prefix)).toBe(
          guard.roles.includes(roleKey)
        );
        expect(canOpenPath(roleKey, `${guard.prefix}/deep/page`)).toBe(
          guard.roles.includes(roleKey)
        );
      }
      expect(guard.roles).toContain(home);
    }
  });

  it("leaves everything outside the portals open to a signed-in user", () => {
    // The middleware has already established there is a live session; these
    // pages are shared by all roles, and the role is not the gate for them.
    for (const pathname of ["/", "/login", "/notifications", "/alerts", "/profile"]) {
      expect(canOpenPath("CAPTAIN", pathname)).toBe(true);
      expect(canOpenPath("RESIDENT", pathname)).toBe(true);
    }
  });

  it("treats an unknown role as a member of no portal", () => {
    expect(canOpenPath("", "/notifications")).toBe(true);
    expect(canOpenPath("MAYOR", "/official/concerns/42")).toBe(false);
    expect(canOpenPath("MAYOR", "/captain")).toBe(false);
  });
});
