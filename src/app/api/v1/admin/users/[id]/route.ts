import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  assertSameOrigin,
  createApiError,
  ok,
  parseBody,
  withErrorBoundary,
} from "@/lib/api";
import { requireApiRole } from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";
import { recordAudit, requestMeta } from "@/lib/audit";
import { adminUserUpdateSchema } from "@/lib/validations/admin";
import {
  USER_COUNT_SELECT,
  adminUserView,
  countActiveAdmins,
  countsForUser,
} from "@/lib/admin/query";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw createApiError.notFound("User not found.");
  }
  return id;
}

function isUniqueConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

/**
 * PATCH /api/v1/admin/users/[id]
 * Updates profile fields, role/office, password, or account status.
 */
export const PATCH = withErrorBoundary<[Request, RouteContext]>(
  async (req, ctx) => {
    assertSameOrigin(req);
    const actor = await requireApiRole(["ADMIN"]);
    const userId = parseId((await ctx.params).id);
    const body = await parseBody(req, adminUserUpdateSchema);

    const target = await db.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });
    if (!target) throw createApiError.notFound("User not found.");

    const isSelf = target.id === actor.id;
    const newRoleKey = body.roleKey ?? target.role.key;
    const newActive = body.isActive ?? target.isActive;

    if (isSelf && body.isActive === false) {
      throw createApiError.badRequest("You cannot disable your own account.");
    }
    if (isSelf && body.roleKey && body.roleKey !== target.role.key) {
      throw createApiError.badRequest("You cannot change your own role.");
    }

    // Never leave the system without an active administrator.
    if (
      target.role.key === "ADMIN" &&
      (newRoleKey !== "ADMIN" || newActive === false)
    ) {
      if ((await countActiveAdmins()) <= 1) {
        throw createApiError.conflict(
          "At least one active administrator is required."
        );
      }
    }

    let roleId = target.roleId;
    if (body.roleKey && body.roleKey !== target.role.key) {
      const role = await db.role.findUnique({ where: { key: body.roleKey } });
      if (!role) throw createApiError.internal("The selected role is not configured.");
      roleId = role.id;
    }

    let officeId: number | null = null;
    if (newRoleKey === "OFFICIAL") {
      const desired = body.officeId !== undefined ? body.officeId : target.officeId;
      if (!desired) {
        throw createApiError.badRequest("Select an office for this official.");
      }
      const office = await db.office.findUnique({ where: { id: desired } });
      if (!office || !office.isActive) {
        throw createApiError.badRequest("Select an active office.");
      }
      officeId = office.id;
    }

    const data: Prisma.UserUpdateInput = {
      isActive: newActive,
      role: { connect: { id: roleId } },
      office:
        officeId === null
          ? { disconnect: true }
          : { connect: { id: officeId } },
    };
    if (body.email !== undefined) data.email = body.email;
    if (body.firstName !== undefined) data.firstName = body.firstName;
    if (body.lastName !== undefined) data.lastName = body.lastName;
    if (body.phone !== undefined) data.phone = body.phone;
    if (body.address !== undefined) data.address = body.address;
    if (body.password !== undefined) {
      data.passwordHash = await hashPassword(body.password);
      // Any password set by an administrator revokes the user's existing
      // sessions immediately.
      data.tokenVersion = { increment: 1 };
    }

    let user;
    try {
      user = await db.user.update({
        where: { id: userId },
        data,
        include: {
          role: true,
          office: true,
          _count: { select: USER_COUNT_SELECT },
        },
      });
    } catch (error) {
      if (isUniqueConflict(error)) {
        throw createApiError.conflict("An account with this email already exists.");
      }
      throw error;
    }

    const statusOnly =
      body.isActive !== undefined &&
      Object.keys(body).length === 1 &&
      body.isActive !== target.isActive;

    const meta = requestMeta(req);
    await recordAudit({
      action: statusOnly ? "USER_STATUS_CHANGED" : "USER_UPDATED",
      resourceType: "user",
      resourceId: String(user.id),
      description: statusOnly
        ? `${user.isActive ? "Enabled" : "Disabled"} account ${user.email}.`
        : `Updated account ${user.email}.`,
      userId: actor.id,
      ...meta,
    });

    return ok({ user: adminUserView(user) });
  }
);

/**
 * DELETE /api/v1/admin/users/[id]
 * Hard-deletes only accounts with no historical references; otherwise the
 * case record would lose its author/actor, so the request is refused with a
 * 409 and the administrator is told to deactivate instead.
 */
export const DELETE = withErrorBoundary<[Request, RouteContext]>(
  async (req, ctx) => {
    assertSameOrigin(req);
    const actor = await requireApiRole(["ADMIN"]);
    const userId = parseId((await ctx.params).id);

    const target = await db.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });
    if (!target) throw createApiError.notFound("User not found.");

    if (target.id === actor.id) {
      throw createApiError.badRequest("You cannot delete your own account.");
    }

    if (target.role.key === "ADMIN" && (await countActiveAdmins()) <= 1) {
      throw createApiError.conflict(
        "At least one active administrator is required."
      );
    }

    const counts = await countsForUser(userId);
    if (!counts) throw createApiError.notFound("User not found.");
    if (counts.total > 0) {
      throw createApiError.conflict(
        `This account is linked to ${counts.total} historical record(s) and cannot be deleted. Deactivate it instead.`
      );
    }

    await db.user.delete({ where: { id: userId } });

    const meta = requestMeta(req);
    await recordAudit({
      action: "USER_DELETED",
      resourceType: "user",
      resourceId: String(userId),
      description: `Deleted unused account ${target.email}.`,
      userId: actor.id,
      ...meta,
    });

    return ok({ deleted: true });
  }
);
