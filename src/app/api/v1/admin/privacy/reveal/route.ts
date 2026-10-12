import {
  assertSameOrigin,
  ok,
  parseBody,
  withErrorBoundary,
} from "@/lib/api";
import { requireApiPermission } from "@/lib/auth/session";
import { recordAudit, requestMeta } from "@/lib/audit";
import { revealPhone } from "@/lib/privacy/service";
import { piiRevealSchema } from "@/lib/validations/privacy";

export const runtime = "nodejs";

/**
 * POST /api/v1/admin/privacy/reveal
 * Unmasks one resident's phone number for an administrator who gives a reason.
 * Every call is written to PiiAccessLog (with the reason) and to the audit
 * trail: RA 10173 accountability means the resident can ask who looked at
 * their data and why.
 */
export const POST = withErrorBoundary(async (req: Request) => {
  assertSameOrigin(req);
  const actor = await requireApiPermission("privacy.pii_access.view");
  const meta = requestMeta(req);
  const body = await parseBody(req, piiRevealSchema);
  const subjectUserId = body.subjectUserId;

  const phone = await revealPhone({
    actorId: actor.id,
    subjectUserId,
    reason: body.reason,
    resourceType: "user",
    resourceId: String(subjectUserId),
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  await recordAudit({
    action: "PII_PHONE_REVEALED",
    resourceType: "user",
    resourceId: String(subjectUserId),
    description: `Viewed the full phone number of user #${subjectUserId}. Reason: ${body.reason}`,
    userId: actor.id,
    ...meta,
  });

  return ok({ subjectUserId, phone, reason: body.reason });
});
