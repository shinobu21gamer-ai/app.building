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
import { officeUpdateSchema } from "@/lib/validations/admin";
import {
  OFFICE_COUNT_SELECT,
  adminOfficeView,
  countsForOffice,
} from "@/lib/admin/query";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw createApiError.notFound("Office not found.");
  }
  return id;
}

function isUniqueConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

export const PATCH = withErrorBoundary<[Request, RouteContext]>(
  async (req, ctx) => {
    assertSameOrigin(req);
    const actor = await requireApiRole(["ADMIN"]);
    const officeId = parseId((await ctx.params).id);
    const body = await parseBody(req, officeUpdateSchema);

    const existing = await db.office.findUnique({ where: { id: officeId } });
    if (!existing) throw createApiError.notFound("Office not found.");
    if (!(body.contact ?? existing.contact).trim()) {
      throw createApiError.badRequest(
        "Contact details are required before this office can be updated."
      );
    }

    let office;
    try {
      office = await db.office.update({
        where: { id: officeId },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.code !== undefined ? { code: body.code } : {}),
          ...(body.description !== undefined
            ? { description: body.description }
            : {}),
          ...(body.headOfficer !== undefined
            ? { headOfficer: body.headOfficer }
            : {}),
          ...(body.contact !== undefined ? { contact: body.contact } : {}),
          ...(body.location !== undefined ? { location: body.location } : {}),
          ...(body.latitude !== undefined ? { latitude: body.latitude } : {}),
          ...(body.longitude !== undefined ? { longitude: body.longitude } : {}),
          ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        },
        include: { _count: { select: OFFICE_COUNT_SELECT } },
      });
    } catch (error) {
      if (isUniqueConflict(error)) {
        throw createApiError.conflict("An office with that code already exists.");
      }
      throw error;
    }

    const statusOnly =
      body.isActive !== undefined &&
      Object.keys(body).length === 1 &&
      body.isActive !== existing.isActive;

    const meta = requestMeta(req);
    await recordAudit({
      action: statusOnly ? "OFFICE_STATUS_CHANGED" : "OFFICE_UPDATED",
      resourceType: "office",
      resourceId: String(office.id),
      description: statusOnly
        ? `${office.isActive ? "Enabled" : "Disabled"} office ${office.code}.`
        : `Updated office ${office.code} (${office.name}).`,
      userId: actor.id,
      ...meta,
    });

    return ok({ office: adminOfficeView(office) });
  }
);

/**
 * DELETE /api/v1/admin/offices/[id]
 * Offices referenced by cases, assignments, routing rules, or users cannot be
 * deleted without breaking historical records, so deactivation is required.
 */
export const DELETE = withErrorBoundary<[Request, RouteContext]>(
  async (req, ctx) => {
    assertSameOrigin(req);
    const actor = await requireApiRole(["ADMIN"]);
    const officeId = parseId((await ctx.params).id);

    const existing = await db.office.findUnique({ where: { id: officeId } });
    if (!existing) throw createApiError.notFound("Office not found.");

    const counts = await countsForOffice(officeId);
    if (!counts) throw createApiError.notFound("Office not found.");
    if (counts.total > 0) {
      throw createApiError.conflict(
        `This office is referenced by ${counts.total} record(s) (cases, assignments, routing rules, or users) and cannot be deleted. Deactivate it instead.`
      );
    }

    await db.office.delete({ where: { id: officeId } });

    const meta = requestMeta(req);
    await recordAudit({
      action: "OFFICE_DELETED",
      resourceType: "office",
      resourceId: String(officeId),
      description: `Deleted unused office ${existing.code}.`,
      userId: actor.id,
      ...meta,
    });

    return ok({ deleted: true });
  }
);
