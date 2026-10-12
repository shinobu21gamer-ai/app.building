import { assertSameOrigin, ok, withErrorBoundary } from "@/lib/api";
import { requireApiPermission } from "@/lib/auth/session";
import { runSlaEscalations } from "@/lib/sla/escalation";

export const runtime = "nodejs";

/**
 * POST /api/v1/admin/sla/scan
 * Runs the escalation job by hand (the cron job calls the same function with
 * `triggeredBy: "CRON"`). `breached` is kept for callers written before the
 * revamp; the full result is returned alongside it.
 */
export const POST = withErrorBoundary<[Request]>(async (req) => {
  assertSameOrigin(req);
  const user = await requireApiPermission("admin.cron.run");
  const result = await runSlaEscalations({ triggeredBy: "MANUAL", actorId: user.id });
  return ok({ breached: result.escalated, ...result });
});
