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
import { recordAudit, requestMeta } from "@/lib/audit";
import { officeCreateSchema } from "@/lib/validations/admin";
import {
  OFFICE_COUNT_SELECT,
  adminOfficeView,
  listAdminOffices,
  parseNameFilters,
} from "@/lib/admin/query";

export const runtime = "nodejs";

function isUniqueConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

export const GET = withErrorBoundary(async (req: Request) => {
  await requireApiRole(["ADMIN"]);
  const { searchParams } = new URL(req.url);
  const offices = await listAdminOffices(parseNameFilters(searchParams));
  return ok({ offices: offices.map(adminOfficeView) });
});

export const POST = withErrorBoundary(async (req: Request) => {
  assertSameOrigin(req);
  const actor = await requireApiRole(["ADMIN"]);
  const body = await parseBody(req, officeCreateSchema);

  let office;
  try {
    office = await db.office.create({
      data: {
        name: body.name,
        code: body.code,
        description: body.description ?? null,
        headOfficer: body.headOfficer ?? null,
        contact: body.contact ?? null,
        isActive: body.isActive ?? true,
      },
      include: { _count: { select: OFFICE_COUNT_SELECT } },
    });
  } catch (error) {
    if (isUniqueConflict(error)) {
      throw createApiError.conflict("An office with that code already exists.");
    }
    throw error;
  }

  const meta = requestMeta(req);
  await recordAudit({
    action: "OFFICE_CREATED",
    resourceType: "office",
    resourceId: String(office.id),
    description: `Created office ${office.code} (${office.name}).`,
    userId: actor.id,
    ...meta,
  });

  return ok({ office: adminOfficeView(office) }, { status: 201 });
});
