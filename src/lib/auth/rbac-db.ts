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
 * Stored override rows for a role. A failing lookup must never lock staff out
 * of the system, so errors fall back to "no overrides" (the code matrix).
 */
export async function loadRolePermissionRows(
  roleKey: string
): Promise<PermissionOverrideRow[]> {
  try {
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
  } catch (error) {
    console.error("[rbac] failed to load role permissions:", error);
    return [];
  }
}

/** Effective permission set for a role: code matrix plus database overrides. */
export async function effectivePermissions(
  roleKey: string
): Promise<ReadonlySet<string>> {
  const rows = await loadRolePermissionRows(roleKey);
  return applyPermissionOverrides(permissionsForRole(roleKey), rows);
}

/** Whether the role currently holds a permission (database overrides included). */
export async function can(
  roleKey: string,
  permission: PermissionKey
): Promise<boolean> {
  const effective = await effectivePermissions(roleKey);
  return effective.has(permission);
}
