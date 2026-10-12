import { NextResponse } from "next/server";

import { recordAudit } from "@/lib/audit";
import { RETENTION_JOB, runRetentionSweep } from "@/lib/privacy/retention";

/**
 * POST/GET /api/v1/cron/retention
 *
 * The retention sweep (README decision 9). Guarded by `CRON_SECRET` exactly like
 * the other scheduled jobs: an unset secret means the endpoint refuses to run at
 * all rather than running unauthenticated.
 *
 * Query parameters, both additive and both off by default:
 *   ?force=1        ignore the once-a-day guard (used after an operator fixes a
 *                   failing policy and wants it swept now)
 *   ?policy=<key>   sweep one policy only, e.g. `?policy=session.revoked_tokens`
 *
 * The response is the sweep's own record: every policy, its cutoff, what was
 * scanned, what changed, and anything that failed. A policy failure is reported
 * in the body with HTTP 500 so a monitoring pager sees it.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

function unauthorized(): NextResponse {
  return NextResponse.json(
    { success: false, error: { code: "UNAUTHORIZED", message: "Unauthorized." } },
    { status: 401 }
  );
}

async function handle(req: Request): Promise<NextResponse> {
  if (!isAuthorized(req)) return unauthorized();

  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";
  const policy = url.searchParams.get("policy");
  const keys = policy ? [policy] : undefined;

  try {
    const result = await runRetentionSweep({
      triggerSource: "CRON",
      force,
      keys,
    });

    await recordAudit(
      {
        action: "privacy.retention.swept",
        resourceType: "CronRun",
        resourceId: String(result.cronRunId),
        description: [
          `${RETENTION_JOB}: ${result.totals.policies.toString()} polic(ies)`,
          `${result.totals.scanned.toString()} scanned`,
          `${result.totals.affected.toString()} affected`,
          result.totals.failed > 0
            ? `${result.totals.failed.toString()} failed`
            : "no failures",
        ].join(", "),
        actorRole: "CRON",
      },
      { actorRole: "CRON" }
    );

    // Every policy's cutoff travels with the counts, so whoever reads the
    // response can see exactly what window was applied.
    const detail = result.outcomes.map((outcome) => ({
      policy: outcome.policyKey,
      action: outcome.action,
      status: outcome.status,
      cutoff: outcome.cutoff.toISOString(),
      scanned: outcome.scanned,
      affected: outcome.affected,
      summary: outcome.summary,
      error: outcome.error,
    }));

    return NextResponse.json(
      {
        success: true,
        data: {
          cronRunId: result.cronRunId,
          startedAt: result.startedAt.toISOString(),
          finishedAt: result.finishedAt.toISOString(),
          totals: result.totals,
          outcomes: detail,
        },
      },
      { status: result.totals.failed > 0 ? 500 : 200 }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Retention sweep failed to start.";
    return NextResponse.json(
      { success: false, error: { code: "JOB_FAILED", message } },
      { status: 500 }
    );
  }
}

export const POST = handle;
export const GET = handle;
