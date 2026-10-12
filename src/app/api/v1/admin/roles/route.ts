import { db } from "@/lib/db";
import { ok, withErrorBoundary } from "@/lib/api";
import { requireApiPermission } from "@/lib/auth/session";
import {
  applyPermissionOverrides,
  permissionDiff,
  permissionsByCategory,
  permissionsForRole,
  type PermissionOverrideRow,
} from "@/lib/auth/rbac";

export const runtime = "nodejs";

/**
 * GET /api/v1/admin/roles
 * The full RBAC picture: the six roles, the permission catalogue, the code
 * matrix and the database overrides on top of it. `bootstrapNeeded` flags a
 * deployment where `npm run db:bootstrap-rbac` has not been run yet.
 */
export const GET = withErrorBoundary(async () => {
  await requireApiPermission("admin.rbac.manage");

  const roles = await db.role.findMany({
    include: {
      _count: { select: { users: true } },
      permissions: {
        select: { allowed: true, permission: { select: { key: true } } },
      },
    },
    orderBy: { key: "asc" },
  });

  const matrix = roles.map((role) => {
    const rows: PermissionOverrideRow[] = role.permissions.map(
      (row: { allowed: boolean; permission: { key: string } }) => ({
        key: row.permission.key,
        allowed: row.allowed,
      })
    );
    const code = permissionsForRole(role.key);
    const effective = [...applyPermissionOverrides(code, rows)].sort();
    return {
      key: role.key,
      name: role.name,
      description: role.description,
      userCount: role._count.users,
      code: [...code].sort(),
      effective,
      overrides: rows,
      diff: permissionDiff(role.key, rows),
    };
  });

  return ok({
    roles: matrix,
    categories: permissionsByCategory(),
    bootstrapNeeded: roles.some((role) => role.permissions.length === 0),
  });
});
