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
import { routingRuleUpdateSchema } from "@/lib/validations/routing";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

function isUniqueConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

export const PUT = withErrorBoundary<[Request, RouteContext]>(
  async (req, ctx) => {
    assertSameOrigin(req);
    const user = await requireApiRole(["ADMIN"]);
    const { id } = await ctx.params;
    const ruleId = Number(id);
    if (!Number.isInteger(ruleId) || ruleId <= 0) {
      throw createApiError.notFound("Routing rule not found.");
    }

    const body = await parseBody(req, routingRuleUpdateSchema);

    const existing = await db.routingRule.findUnique({
      where: { id: ruleId },
      include: { category: true, office: true },
    });
    if (!existing) throw createApiError.notFound("Routing rule not found.");

    const categoryId = body.categoryId ?? existing.categoryId;
    const officeId = body.officeId ?? existing.officeId;

    if (body.categoryId !== undefined) {
      const category = await db.concernCategory.findUnique({
        where: { id: categoryId },
      });
      if (!category || !category.isActive) {
        throw createApiError.badRequest("Select an active concern category.");
      }
    }
    if (body.officeId !== undefined) {
      const office = await db.office.findUnique({ where: { id: officeId } });
      if (!office || !office.isActive) {
        throw createApiError.badRequest("Select an active office.");
      }
    }

    if (
      categoryId !== existing.categoryId ||
      officeId !== existing.officeId
    ) {
      const duplicate = await db.routingRule.findFirst({
        where: { categoryId, officeId, id: { not: ruleId } },
      });
      if (duplicate) {
        throw createApiError.conflict(
          "A routing rule for that category and office already exists."
        );
      }
    }

    let rule;
    try {
      rule = await db.routingRule.update({
        where: { id: ruleId },
        data: {
          categoryId,
          officeId,
          priorityOrder: body.priorityOrder ?? existing.priorityOrder,
          isActive: body.isActive ?? existing.isActive,
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
      action: "ROUTING_RULE_UPDATED",
      resourceType: "routing_rule",
      resourceId: String(rule.id),
      description: `Updated routing rule ${rule.category.code} -> ${rule.office.code}${
        rule.isActive ? "" : " (disabled)"
      }.`,
      userId: user.id,
      ...meta,
    });

    return ok({ rule });
  }
);

/**
 * DELETE /api/v1/admin/routing-rules/[id]
 * Routing rules are pure configuration (routing is resolved at submission
 * time and stored on the concern), so they may be safely removed.
 */
export const DELETE = withErrorBoundary<[Request, RouteContext]>(
  async (req, ctx) => {
    assertSameOrigin(req);
    const user = await requireApiRole(["ADMIN"]);
    const { id } = await ctx.params;
    const ruleId = Number(id);
    if (!Number.isInteger(ruleId) || ruleId <= 0) {
      throw createApiError.notFound("Routing rule not found.");
    }

    const existing = await db.routingRule.findUnique({
      where: { id: ruleId },
      include: { category: true, office: true },
    });
    if (!existing) throw createApiError.notFound("Routing rule not found.");

    await db.routingRule.delete({ where: { id: ruleId } });

    const meta = requestMeta(req);
    await recordAudit({
      action: "ROUTING_RULE_DELETED",
      resourceType: "routing_rule",
      resourceId: String(ruleId),
      description: `Deleted routing rule ${existing.category.code} -> ${existing.office.code}.`,
      userId: user.id,
      ...meta,
    });

    return ok({ deleted: true });
  }
);
