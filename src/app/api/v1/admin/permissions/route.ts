import { db } from "@/lib/db";
import {
  assertSameOrigin,
  createApiError,
  ok,
  parseBody,
  withErrorBoundary,
} from "@/lib/api";
import { requireApiPermission } from "@/lib/auth/session";
import { recordAudit, requestMeta } from "@/lib/audit";
import { permissionDefinition, isPermissionKey } from "@/lib/auth/rbac";
import { effectivePermissions } from "@/lib/auth/rbac-db";
import { isRoleKey } from "@/lib/auth/roles";
import { rolePermissionOverrideSchema } from "@/lib/validations/admin";

export const runtime = "nodejs";

/**
 * PUT /api/v1/admin/permissions
 * Grants or revokes a single permission for a role. The database row wins over
 * the code matrix, so this takes effect on the role's next request without a
 * deploy. The permission catalogue is self-healing: an override for a
 * permission that has no row yet creates the row from code.
 */
export const PUT = withErrorBoundary(async (req: Request) => {
  assertSameOrigin(req);
  const actor = await requireApiPermission("admin.rbac.manage");
  const body = await parseBody(req, rolePermissionOverrideSchema);

  if (!isPermissionKey(body.permissionKey)) {
    throw createApiError.badRequest("Unknown permission key.");
  }
  if (!isRoleKey(body.roleKey)) {
    throw createApiError.badRequest("Unknown role.");
  }

  const definition = permissionDefinition(body.permissionKey);
  if (!definition) throw createApiError.badRequest("Unknown permission key.");

  const role = await db.role.findUnique({ where: { key: body.roleKey } });
  if (!role) throw createApiError.notFound("Role not found.");

  const permission = await db.permission.upsert({
    where: { key: definition.key },
    update: { category: definition.category, description: definition.description },
    create: {
      key: definition.key,
      category: definition.category,
      description: definition.description,
    },
  });

  const row = await db.rolePermission.upsert({
    where: {
      roleId_permissionId: { roleId: role.id, permissionId: permission.id },
    },
    update: { allowed: body.allowed, updatedById: actor.id },
    create: {
      roleId: role.id,
      permissionId: permission.id,
      allowed: body.allowed,
      updatedById: actor.id,
    },
  });

  const meta = requestMeta(req);
  await recordAudit({
    action: body.allowed ? "ROLE_PERMISSION_GRANTED" : "ROLE_PERMISSION_REVOKED",
    resourceType: "role_permission",
    resourceId: `${body.roleKey}:${body.permissionKey}`,
    description: `${body.allowed ? "Granted" : "Revoked"} ${body.permissionKey} for ${body.roleKey}.`,
    userId: actor.id,
    ...meta,
  });

  return ok({
    override: {
      roleKey: body.roleKey,
      permissionKey: body.permissionKey,
      allowed: row.allowed,
      updatedById: row.updatedById,
    },
    effective: [...(await effectivePermissions(body.roleKey))].sort(),
  });
});

/**
 * DELETE /api/v1/admin/permissions?roleKey=&permissionKey=
 * Removes an override so the role falls back to the code matrix.
 */
export const DELETE = withErrorBoundary(async (req: Request) => {
  assertSameOrigin(req);
  const actor = await requireApiPermission("admin.rbac.manage");

  const { searchParams } = new URL(req.url);
  const parsed = rolePermissionOverrideSchema.safeParse({
    roleKey: searchParams.get("roleKey"),
    permissionKey: searchParams.get("permissionKey"),
    // `allowed` is not part of a deletion; the schema requires it, so pass the
    // value the row currently has and ignore it afterwards.
    allowed: "true",
  });
  if (!parsed.success) {
    throw createApiError.badRequest("A role and permission key are required.");
  }
  const { roleKey, permissionKey } = parsed.data;

  const role = await db.role.findUnique({ where: { key: roleKey } });
  if (!role) throw createApiError.notFound("Role not found.");
  const permission = await db.permission.findUnique({
    where: { key: permissionKey },
  });
  if (!permission) throw createApiError.notFound("Permission not found.");

  const deleted = await db.rolePermission.deleteMany({
    where: { roleId: role.id, permissionId: permission.id },
  });

  if (deleted.count > 0) {
    const meta = requestMeta(req);
    await recordAudit({
      action: "ROLE_PERMISSION_CLEARED",
      resourceType: "role_permission",
      resourceId: `${roleKey}:${permissionKey}`,
      description: `Removed the ${permissionKey} override for ${roleKey}; the code matrix applies again.`,
      userId: actor.id,
      ...meta,
    });
  }

  return ok({
    cleared: deleted.count > 0,
    effective: [...(await effectivePermissions(roleKey))].sort(),
  });
});
