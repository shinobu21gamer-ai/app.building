import {
  assertSameOrigin,
  ok,
  parseBody,
  withErrorBoundary,
} from "@/lib/api";
import { requireApiPermission } from "@/lib/auth/session";
import { runRetentionSweep } from "@/lib/privacy/retention";
import { retentionRunSchema } from "@/lib/validations/retention";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/admin/privacy/retention
 *
 * Runs the retention sweep by hand — the same function the cron job calls, with
 * the same run records. `force` is implied: an administrator clicking "run now"
 * has already decided, so the once-a-day guard is skipped for this call only.
 *
 * Body: `{ policy?: string }` narrows the sweep to one policy.
 */
export const POST = withErrorBoundary<[Request]>(async (req) => {
  assertSameOrigin(req);
  const user = await requireApiPermission("privacy.retention.manage");
  const input = await parseBody(req, retentionRunSchema);

  const result = await runRetentionSweep({
    triggerSource: "ADMIN",
    actorId: user.id,
    force: true,
    keys: input.policy ? [input.policy] : undefined,
  });

  return ok({
    cronRunId: result.cronRunId,
    startedAt: result.startedAt.toISOString(),
    finishedAt: result.finishedAt.toISOString(),
    totals: result.totals,
    outcomes: result.outcomes.map((outcome) => ({
      policy: outcome.policyKey,
      action: outcome.action,
      status: outcome.status,
      cutoff: outcome.cutoff.toISOString(),
      scanned: outcome.scanned,
      affected: outcome.affected,
      summary: outcome.summary,
      error: outcome.error,
    })),
  });
});
