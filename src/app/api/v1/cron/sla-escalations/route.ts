import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { runSlaEscalations } from "@/lib/sla/escalation";

// The 48-hour escalation job. Same guard as /api/v1/cron/email-deliveries: only
// a caller holding CRON_SECRET gets through, and nothing happens without it.
// The scheduler is .github/workflows/sla-cron.yml (hourly); a Vercel cron entry
// pointed at this path works too, because GET and POST are equivalent here.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(req: Request): boolean {
  return isCronAuthorized(req);
}

async function handle(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Unauthorized." } },
      { status: 401 }
    );
  }

  const result = await runSlaEscalations({ triggeredBy: "CRON" });
  if (result.status === "FAILED") {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "JOB_FAILED",
          message: result.error ?? "Escalation job failed.",
        },
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, data: result });
}

export const POST = handle;
export const GET = handle;
