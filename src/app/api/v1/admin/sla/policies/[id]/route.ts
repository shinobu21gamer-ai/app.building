import { db } from "@/lib/db";
import {
  assertSameOrigin,
  createApiError,
  ok,
  parseBody,
  withErrorBoundary,
} from "@/lib/api";
import { requireApiPermission } from "@/lib/auth/session";
import { requestMeta } from "@/lib/audit";
import {
  listSlaPolicies,
  setSlaPolicyActive,
  upsertSlaPolicy,
} from "@/lib/sla/escalation";
import { slaPolicySaveSchema, slaPolicyToggleSchema } from "@/lib/validations/sla";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

function policyId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw createApiError.notFound("Policy not found.");
  }
  return id;
}

async function assertPolicyExists(id: number): Promise<void> {
  const policy = await db.slaPolicy.findUnique({ where: { id }, select: { id: true } });
  if (!policy) throw createApiError.notFound("Policy not found.");
}

/**
 * PATCH /api/v1/admin/sla/policies/{id}
 * Updates a policy, or flips just its `isActive` flag: deactivating is how a
 * window is retired without losing the escalations it already produced.
 */
export const PATCH = withErrorBoundary<[Request, RouteContext]>(
  async (req, ctx) => {
    assertSameOrigin(req);
    const user = await requireApiPermission("sla.policy.manage");
    const id = policyId((await ctx.params).id);
    await assertPolicyExists(id);

    const body = (await req.clone().json().catch(() => ({}))) as Record<string, unknown>;
    const toggleOnly =
      Object.keys(body).length > 0 &&
      Object.keys(body).every((key) => key === "isActive");

    if (toggleOnly) {
      const input = await parseBody(req, slaPolicyToggleSchema);
      const saved = await setSlaPolicyActive({
        id,
        isActive: input.isActive,
        actorId: user.id,
        actorRoleKey: user.role.key,
        meta: requestMeta(req),
      });
      return ok({ policy: saved, policies: await listSlaPolicies() });
    }

    const input = await parseBody(req, slaPolicySaveSchema);
    const clash = await db.slaPolicy.findFirst({
      where: { key: input.key, id: { not: id } },
      select: { id: true },
    });
    if (clash) {
      throw createApiError.conflict(`Another policy already uses the key "${input.key}".`);
    }

    const saved = await upsertSlaPolicy({
      id,
      ...input,
      actorId: user.id,
      actorRoleKey: user.role.key,
      meta: requestMeta(req),
    });
    return ok({ policy: saved, policies: await listSlaPolicies() });
  }
);
