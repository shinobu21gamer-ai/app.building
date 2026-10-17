import { describe, expect, it } from "vitest";
import {
  PERMISSIONS,
  PERMISSION_CATEGORIES,
  ROLE_PERMISSIONS,
  applyPermissionOverrides,
  caseScopeFor,
  isPermissionKey,
  permissionDefinition,
  permissionDiff,
  permissionsByCategory,
  permissionsForRole,
  roleHasCodePermission,
} from "./rbac";
import { ROLE_KEYS } from "./roles";

describe("permission catalogue", () => {
  it("has unique keys, known categories and a description", () => {
    const keys = PERMISSIONS.map((permission) => permission.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const permission of PERMISSIONS) {
      expect(PERMISSION_CATEGORIES).toContain(permission.category);
      expect(permission.description.length).toBeGreaterThan(10);
    }
  });

  it("groups every permission into a category exactly once", () => {
    const grouped = permissionsByCategory().flatMap((group) =>
      group.permissions.map((permission) => permission.key)
    );
    expect(grouped.sort()).toEqual(
      PERMISSIONS.map((permission) => permission.key).sort()
    );
  });

  it("recognises catalogue keys only", () => {
    expect(isPermissionKey("case.validate")).toBe(true);
    expect(isPermissionKey("case.obliterate")).toBe(false);
    expect(permissionDefinition("case.validate")?.category).toBe("CASE");
  });
});

describe("role matrix", () => {
  it("covers the six roles and references only catalogue keys", () => {
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual([...ROLE_KEYS].sort());
    for (const role of ROLE_KEYS) {
      const permissions = permissionsForRole(role);
      expect(permissions.length).toBeGreaterThan(0);
      for (const permission of permissions) {
        expect(isPermissionKey(permission)).toBe(true);
      }
      expect(new Set(permissions).size).toBe(permissions.length);
    }
  });

  it("keeps validation, treasury and RBAC administration out of the field roles", () => {
    expect(roleHasCodePermission("RESIDENT", "case.validate")).toBe(false);
    expect(roleHasCodePermission("OFFICIAL", "case.validate")).toBe(false);
    expect(roleHasCodePermission("ADMIN", "case.validate")).toBe(true);

    expect(roleHasCodePermission("OFFICIAL", "treasury.disbursement.approve")).toBe(
      false
    );
    expect(roleHasCodePermission("TREASURER", "treasury.disbursement.approve")).toBe(
      false
    );
    expect(roleHasCodePermission("TREASURER", "treasury.disbursement.certify")).toBe(
      true
    );
    expect(roleHasCodePermission("CAPTAIN", "treasury.disbursement.approve")).toBe(
      true
    );

    expect(roleHasCodePermission("TREASURER", "admin.rbac.manage")).toBe(false);
    expect(roleHasCodePermission("ADMIN", "admin.rbac.manage")).toBe(true);
  });

  it("lets the treasurer correct an appropriation, but not the captain who approves it", () => {
    expect(roleHasCodePermission("TREASURER", "treasury.allocation.adjust")).toBe(
      true
    );
    expect(roleHasCodePermission("ADMIN", "treasury.allocation.adjust")).toBe(true);
    // Approving and adjusting the same money stays with different roles.
    expect(roleHasCodePermission("CAPTAIN", "treasury.allocation.adjust")).toBe(
      false
    );
    expect(roleHasCodePermission("OFFICIAL", "treasury.allocation.adjust")).toBe(
      false
    );
  });

  it("separates segregation-of-duty pairs", () => {
    // Certifying funds and approving the release must never be the same role.
    expect(
      permissionsForRole("CAPTAIN").includes("treasury.disbursement.certify")
    ).toBe(false);
    // Closing a case is the captain's prerogative, not the official's.
    expect(roleHasCodePermission("OFFICIAL", "case.status.close")).toBe(false);
    // Crew only ever sees their own jobs.
    expect(roleHasCodePermission("CREW", "case.view.all")).toBe(false);
    expect(roleHasCodePermission("CREW", "crew.job.update.own")).toBe(true);
  });

  it("returns nothing for an unknown role", () => {
    expect(permissionsForRole("WIZARD")).toEqual([]);
    expect(roleHasCodePermission("WIZARD", "case.validate")).toBe(false);
  });
});

describe("applyPermissionOverrides", () => {
  const code = ["case.assess", "case.manpower.plan"] as const;

  it("keeps the code default when there are no rows", () => {
    expect([...applyPermissionOverrides(code, [])].sort()).toEqual([
      "case.assess",
      "case.manpower.plan",
    ]);
  });

  it("grants with an allowed row and revokes with a denied row", () => {
    const granted = applyPermissionOverrides(code, [
      { key: "case.crew.assign", allowed: true },
    ]);
    expect(granted.has("case.crew.assign")).toBe(true);

    const revoked = applyPermissionOverrides(code, [
      { key: "case.assess", allowed: false },
    ]);
    expect(revoked.has("case.assess")).toBe(false);
    expect(revoked.has("case.manpower.plan")).toBe(true);
  });

  it("ignores rows for permissions that are not in the catalogue", () => {
    const effective = applyPermissionOverrides(code, [
      { key: "not.a.real.permission", allowed: true },
    ]);
    expect([...effective].sort()).toEqual(["case.assess", "case.manpower.plan"]);
  });
});

describe("permissionDiff", () => {
  it("classifies rows as granted, revoked or redundant", () => {
    const diff = permissionDiff("OFFICIAL", [
      { key: "case.assess", allowed: true }, // redundant: code already grants it
      { key: "case.validate", allowed: true }, // granted extra
      { key: "case.manpower.plan", allowed: false }, // revoked
      { key: "case.crew.assign", allowed: false }, // revoked
      { key: "mystery.permission", allowed: true }, // unknown: ignored
    ]);
    expect(diff.granted).toEqual(["case.validate"]);
    expect(diff.revoked).toEqual(["case.crew.assign", "case.manpower.plan"]);
    expect(diff.redundant).toEqual(["case.assess"]);
  });
});

describe("caseScopeFor", () => {
  it("maps each role to its visibility scope", () => {
    expect(caseScopeFor("ADMIN")).toBe("all");
    expect(caseScopeFor("CAPTAIN")).toBe("all");
    expect(caseScopeFor("OFFICIAL")).toBe("office");
    expect(caseScopeFor("CREW")).toBe("assigned");
    expect(caseScopeFor("RESIDENT")).toBe("own");
    expect(caseScopeFor("UNKNOWN")).toBe("none");
  });
});
