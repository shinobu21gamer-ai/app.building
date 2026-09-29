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
import { adminUserCreateSchema } from "@/lib/validations/admin";
import {
  USER_COUNT_SELECT,
  adminUserView,
  listAdminUsers,
  parseUserFilters,
} from "@/lib/admin/query";

export const runtime = "nodejs";

function isUniqueConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

/**
 * GET /api/v1/admin/users?q=&role=&status=
 * Lists users with role/office and reference counts. ADMIN only.
 */
export const GET = withErrorBoundary(async (req: Request) => {
  await requireApiRole(["ADMIN"]);
  const { searchParams } = new URL(req.url);
  const users = await listAdminUsers(parseUserFilters(searchParams));
  return ok({ users: users.map(adminUserView) });
});

/**
 * POST /api/v1/admin/users
 * Creates a resident, official, or administrator account.
 */
export const POST = withErrorBoundary(async (req: Request) => {
  assertSameOrigin(req);
  const actor = await requireApiRole(["ADMIN"]);
  const body = await parseBody(req, adminUserCreateSchema);

  const role = await db.role.findUnique({ where: { key: body.roleKey } });
  if (!role) throw createApiError.internal("The selected role is not configured.");

  let officeId: number | null = null;
  if (body.roleKey === "OFFICIAL") {
    if (!body.officeId) {
      throw createApiError.badRequest("Select an office for this official.");
    }
    const office = await db.office.findUnique({ where: { id: body.officeId } });
    if (!office || !office.isActive) {
      throw createApiError.badRequest("Select an active office.");
    }
    officeId = office.id;
  } else if (body.officeId) {
    throw createApiError.badRequest("Only officials can be linked to an office.");
  }

  const passwordHash = await hashPassword(body.password);

  let user;
  try {
    user = await db.user.create({
      data: {
        email: body.email,
        passwordHash,
        firstName: body.firstName,
        lastName: body.lastName,
        phone: body.phone ?? null,
        address: body.address ?? null,
        roleId: role.id,
        officeId,
        isActive: body.isActive ?? true,
      },
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

  const meta = requestMeta(req);
  await recordAudit({
    action: "USER_CREATED",
    resourceType: "user",
    resourceId: String(user.id),
    description: `Created ${body.roleKey} account ${user.email}.`,
    userId: actor.id,
    ...meta,
  });

  return ok({ user: adminUserView(user) }, { status: 201 });
});
