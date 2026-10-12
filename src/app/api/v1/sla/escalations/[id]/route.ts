import {
  assertSameOrigin,
  createApiError,
  ok,
  parseBody,
  withErrorBoundary,
} from "@/lib/api";
import { requireApiPermission } from "@/lib/auth/session";
import { actOnEscalation } from "@/lib/sla/escalation";
import { escalationActionSchema } from "@/lib/validations/sla";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * PATCH /api/v1/sla/escalations/{id}
 * Acknowledge ("seen, someone owns it") or resolve ("the case is out of the
 * woods") an escalation. Both are audited and both write a case-history entry,
 * so the case page and the queue never disagree.
 *
 * The Captain holds `sla.escalation.acknowledge`; the administrator holds every
 * permission, which is what makes the admin queue a supervisor view.
 */
export const PATCH = withErrorBoundary<[Request, RouteContext]>(
  async (req, ctx) => {
    assertSameOrigin(req);
    const user = await requireApiPermission("sla.escalation.acknowledge");
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id <= 0) {
      throw createApiError.notFound("Escalation not found.");
    }
    const input = await parseBody(req, escalationActionSchema);

    try {
      const row = await actOnEscalation({
        id,
        actorId: user.id,
        actorRoleKey: user.role.key,
        action: input.action,
        note: input.note ?? null,
      });
      return ok({ escalation: row });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message === "not-found") {
        throw createApiError.notFound("Escalation not found.");
      }
      if (message === "already-resolved") {
        throw createApiError.conflict("That escalation is already resolved.");
      }
      throw error;
    }
  }
);
