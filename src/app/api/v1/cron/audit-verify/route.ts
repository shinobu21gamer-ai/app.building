import { NextResponse } from "next/server";
import { recordAudit } from "@/lib/audit";
import { serializeAuditReport, verifyAuditChain } from "@/lib/audit/store";

// Verifies the whole audit chain and records an AuditVerificationRun — the
// digest an auditor compares against. Guarded by CRON_SECRET like the other
// scheduled jobs.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const authorization = req.headers.get("authorization");
  return authorization === `Bearer ${secret}`;
}

async function handle(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Unauthorized." } },
      { status: 401 }
    );
  }

  const report = await verifyAuditChain({ triggeredBy: "CRON" });

  // The verification is itself an audited action.
  await recordAudit(
    {
      action: "audit.chain.verified",
      resourceType: "AuditVerificationRun",
      resourceId: report.runId === null ? undefined : String(report.runId),
      description: `status ${report.status}, checked ${report.checkedCount} row(s), seq ${report.fromSeq.toString()}–${report.toSeq.toString()}${
        report.firstBrokenSeq === null ? "" : `, first broken seq ${report.firstBrokenSeq.toString()}`
      }`,
      actorRole: "CRON",
    },
    { actorRole: "CRON" }
  );

  return NextResponse.json(
    { success: true, data: serializeAuditReport(report) },
    { status: report.status === "FAILED" ? 500 : 200 }
  );
}

export const POST = handle;
export const GET = handle;
