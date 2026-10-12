import { assertSameOrigin, ok, parseBody, withErrorBoundary } from "@/lib/api";
import { requireApiPermission } from "@/lib/auth/session";
import { recordAudit, requestMeta } from "@/lib/audit";
import { serializeAuditReport, verifyAuditChain } from "@/lib/audit/store";
import { auditVerifySchema } from "@/lib/validations/audit";

export const runtime = "nodejs";

/**
 * POST /api/v1/admin/audit/verify
 * Runs a chain verification on demand (the same job the weekly cron runs) and
 * records an AuditVerificationRun. A BROKEN verdict is the one result an
 * administrator must act on: the trail no longer matches itself.
 */
export const POST = withErrorBoundary<[Request]>(async (req) => {
  assertSameOrigin(req);
  const user = await requireApiPermission("admin.cron.run");
  const input = await parseBody(req, auditVerifySchema);
  const meta = requestMeta(req);

  const report = await verifyAuditChain({
    triggeredBy: "ADMIN",
    actorId: user.id,
    fromSeq: input.fromSeq ?? null,
    toSeq: input.toSeq ?? null,
  });

  await recordAudit(
    {
      action: "audit.chain.verified",
      resourceType: "AuditVerificationRun",
      resourceId: report.runId === null ? undefined : String(report.runId),
      description: `status ${report.status}, checked ${report.checkedCount} row(s), seq ${report.fromSeq.toString()}–${report.toSeq.toString()}${
        report.firstBrokenSeq === null ? "" : `, first broken seq ${report.firstBrokenSeq.toString()}`
      }`,
      userId: user.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
    },
    { actorRole: user.role.key }
  );

  return ok({ report: serializeAuditReport(report) });
});
