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
import { routingRuleCreateSchema } from "@/lib/validations/routing";
import { loadRoutingRules } from "@/lib/routing/config";

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
  const activeOnly = searchParams.get("active") === "true";
  const rules = await loadRoutingRules({ activeOnly });
  return ok({ rules });
});

export const POST = withErrorBoundary(async (req: Request) => {
  assertSameOrigin(req);
  const user = await requireApiRole(["ADMIN"]);
  const body = await parseBody(req, routingRuleCreateSchema);

  const [category, office] = await Promise.all([
    db.concernCategory.findUnique({ where: { id: body.categoryId } }),
    db.office.findUnique({ where: { id: body.officeId } }),
  ]);
  if (!category || !category.isActive) {
    throw createApiError.badRequest("Select an active concern category.");
  }
  if (!office || !office.isActive) {
    throw createApiError.badRequest("Select an active office.");
  }

  let rule;
  try {
    rule = await db.routingRule.create({
      data: {
        categoryId: body.categoryId,
        officeId: body.officeId,
        priorityOrder: body.priorityOrder ?? 1,
        isActive: body.isActive ?? true,
      },
      include: { category: true, office: true },
    });
  } catch (error) {
    if (isUniqueConflict(error)) {
      throw createApiError.conflict(
        "A routing rule for that category and office already exists."
      );
    }
    throw error;
  }

  const meta = requestMeta(req);
  await recordAudit({
    action: "ROUTING_RULE_CREATED",
    resourceType: "routing_rule",
    resourceId: String(rule.id),
    description: `Created routing rule ${category.code} -> ${office.code}.`,
    userId: user.id,
    ...meta,
  });

  return ok({ rule }, { status: 201 });
});
