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
import { listSlaPolicies, upsertSlaPolicy } from "@/lib/sla/escalation";
import { slaPolicySaveSchema } from "@/lib/validations/sla";

export const runtime = "nodejs";

/**
 * GET /api/v1/admin/sla/policies
 * Every SLA policy, active or not, with how many escalations are still open
 * against it.
 */
export const GET = withErrorBoundary<[Request]>(async () => {
  await requireApiPermission("sla.escalation.view");
  return ok({ policies: await listSlaPolicies() });
});

/**
 * POST /api/v1/admin/sla/policies
 * Creates a policy. The key is unique: a second policy with the same key is a
 * mistake, not an edit — the [id] route updates one.
 */
export const POST = withErrorBoundary<[Request]>(async (req) => {
  assertSameOrigin(req);
  const user = await requireApiPermission("sla.policy.manage");
  const input = await parseBody(req, slaPolicySaveSchema);

  const existing = await db.slaPolicy.findUnique({
    where: { key: input.key },
    select: { id: true },
  });
  if (existing) {
    throw createApiError.conflict(
      `A policy with the key "${input.key}" already exists.`
    );
  }

  const saved = await upsertSlaPolicy({
    ...input,
    actorId: user.id,
    actorRoleKey: user.role.key,
    meta: requestMeta(req),
  });

  return ok({ policy: saved, policies: await listSlaPolicies() });
});
