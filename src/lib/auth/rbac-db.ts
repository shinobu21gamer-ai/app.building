// Database half of the RBAC layer: stored permission overrides.
//
// The code matrix in `./rbac` is the default; a `RolePermission` row always
// wins, so an administrator can grant or revoke a single capability without a
// deploy and deleting the row falls back to code. Kept separate from `./rbac`
// so the catalogue, the matrix and the pure override maths stay importable
// without a Prisma client (unit tests, client components).

import { db } from "@/lib/db";
import {
  applyPermissionOverrides,
  permissionsForRole,
  type PermissionKey,
  type PermissionOverrideRow,
} from "@/lib/auth/rbac";

/**
 * Stored override rows for a role. Throws on a failing lookup: a revocation
 * must never be silently ignored, so callers decide what an unknown answer means
 * (see `effectivePermissions`, which denies).
 */
async function fetchRolePermissionRows(
  roleKey: string
): Promise<PermissionOverrideRow[]> {
  const role = await db.role.findUnique({
    where: { key: roleKey },
    select: {
      permissions: {
        select: { allowed: true, permission: { select: { key: true } } },
      },
    },
  });
  if (!role) return [];
  return role.permissions.map(
    (row: { allowed: boolean; permission: { key: string } }) => ({
      key: row.permission.key,
      allowed: row.allowed,
    })
  );
}

/**
 * Effective permission set for a role: code matrix plus database overrides.
 * If the override lookup fails, the role gets NO permissions. Failing open here
 * would let a revoked capability come back during a database error. A database
 * outage also breaks the session lookup, so nobody is locked out who could have
 * got in anyway.
 */
export async function effectivePermissions(
  roleKey: string
): Promise<ReadonlySet<string>> {
  try {
    const rows = await fetchRolePermissionRows(roleKey);
    return applyPermissionOverrides(permissionsForRole(roleKey), rows);
  } catch (error) {
    console.error("[rbac] failed to load role permissions; denying:", error);
    return new Set<string>();
  }
}

/** Stored override rows for a role (admin view); a failed lookup returns none. */
export async function loadRolePermissionRows(
  roleKey: string
): Promise<PermissionOverrideRow[]> {
  try {
    return await fetchRolePermissionRows(roleKey);
  } catch (error) {
    console.error("[rbac] failed to load role permission rows:", error);
    return [];
  }
}

/** Whether the role currently holds a permission (database overrides included). */
export async function can(
  roleKey: string,
  permission: PermissionKey
): Promise<boolean> {
  const effective = await effectivePermissions(roleKey);
  return effective.has(permission);
}
