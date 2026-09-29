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
import { categoryUpdateSchema } from "@/lib/validations/admin";
import {
  CATEGORY_COUNT_SELECT,
  adminCategoryView,
  countsForCategory,
} from "@/lib/admin/query";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw createApiError.notFound("Category not found.");
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
    const categoryId = parseId((await ctx.params).id);
    const body = await parseBody(req, categoryUpdateSchema);

    const existing = await db.concernCategory.findUnique({
      where: { id: categoryId },
    });
    if (!existing) throw createApiError.notFound("Category not found.");

    let category;
    try {
      category = await db.concernCategory.update({
        where: { id: categoryId },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.code !== undefined ? { code: body.code } : {}),
          ...(body.description !== undefined
            ? { description: body.description }
            : {}),
          ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        },
        include: { _count: { select: CATEGORY_COUNT_SELECT } },
      });
    } catch (error) {
      if (isUniqueConflict(error)) {
        throw createApiError.conflict("A category with that code already exists.");
      }
      throw error;
    }

    const statusOnly =
      body.isActive !== undefined &&
      Object.keys(body).length === 1 &&
      body.isActive !== existing.isActive;

    const meta = requestMeta(req);
    await recordAudit({
      action: statusOnly ? "CATEGORY_STATUS_CHANGED" : "CATEGORY_UPDATED",
      resourceType: "concern_category",
      resourceId: String(category.id),
      description: statusOnly
        ? `${category.isActive ? "Enabled" : "Disabled"} category ${category.code}.`
        : `Updated category ${category.code} (${category.name}).`,
      userId: actor.id,
      ...meta,
    });

    return ok({ category: adminCategoryView(category) });
  }
);

/**
 * DELETE /api/v1/admin/concern-categories/[id]
 * Categories referenced by concerns or routing rules must be deactivated.
 */
export const DELETE = withErrorBoundary<[Request, RouteContext]>(
  async (req, ctx) => {
    assertSameOrigin(req);
    const actor = await requireApiRole(["ADMIN"]);
    const categoryId = parseId((await ctx.params).id);

    const existing = await db.concernCategory.findUnique({
      where: { id: categoryId },
    });
    if (!existing) throw createApiError.notFound("Category not found.");

    const counts = await countsForCategory(categoryId);
    if (!counts) throw createApiError.notFound("Category not found.");
    if (counts.total > 0) {
      throw createApiError.conflict(
        `This category is referenced by ${counts.total} record(s) (concerns or routing rules) and cannot be deleted. Deactivate it instead.`
      );
    }

    await db.concernCategory.delete({ where: { id: categoryId } });

    const meta = requestMeta(req);
    await recordAudit({
      action: "CATEGORY_DELETED",
      resourceType: "concern_category",
      resourceId: String(categoryId),
      description: `Deleted unused category ${existing.code}.`,
      userId: actor.id,
      ...meta,
    });

    return ok({ deleted: true });
  }
);
