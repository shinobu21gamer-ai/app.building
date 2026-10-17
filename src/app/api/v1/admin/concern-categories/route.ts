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
import { categoryCreateSchema } from "@/lib/validations/admin";
import {
  CATEGORY_COUNT_SELECT,
  adminCategoryView,
  listAdminCategories,
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
  const categories = await listAdminCategories(parseNameFilters(searchParams));
  return ok({ categories: categories.map(adminCategoryView) });
});

export const POST = withErrorBoundary(async (req: Request) => {
  assertSameOrigin(req);
  const actor = await requireApiRole(["ADMIN"]);
  const body = await parseBody(req, categoryCreateSchema);

  if (body.typeId != null) {
    const type = await db.concernType.findUnique({
      where: { id: body.typeId },
      select: { id: true, isActive: true },
    });
    if (!type || !type.isActive) {
      throw createApiError.badRequest("Select an active service type.");
    }
  }

  let category;
  try {
    category = await db.concernCategory.create({
      data: {
        name: body.name,
        code: body.code,
        description: body.description ?? null,
        isActive: body.isActive ?? true,
        typeId: body.typeId ?? null,
      },
      include: {
        _count: { select: CATEGORY_COUNT_SELECT },
        type: { select: { id: true, name: true } },
      },
    });
  } catch (error) {
    if (isUniqueConflict(error)) {
      throw createApiError.conflict("A category with that code already exists.");
    }
    throw error;
  }

  const meta = requestMeta(req);
  await recordAudit({
    action: "CATEGORY_CREATED",
    resourceType: "concern_category",
    resourceId: String(category.id),
    description: `Created category ${category.code} (${category.name}).`,
    userId: actor.id,
    ...meta,
  });

  return ok({ category: adminCategoryView(category) }, { status: 201 });
});
