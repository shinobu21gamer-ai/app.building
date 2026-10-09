import { db } from "@/lib/db";
import {
  assertSameOrigin,
  createApiError,
  ok,
  parseBody,
  withErrorBoundary,
} from "@/lib/api";
import { requestMeta } from "@/lib/audit";
import { statusLabel } from "@/lib/cases/workflow";
import { checkTrackAllowed, recordTrackFailure } from "@/lib/rate-limit";
import { trackConcernSchema } from "@/lib/validations/concern";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOOKUP_ERROR =
  "No matching case. Check the case number and the email used to submit it.";

/**
 * POST /api/v1/concerns/track
 * Public, throttled lookup. Requires the case number AND the submitter's
 * email so sequential case numbers cannot be enumerated. Returns only
 * status-level fields — no photo, address, remarks, or reporter name.
 */
export const POST = withErrorBoundary(async (req: Request) => {
  assertSameOrigin(req);
  const data = await parseBody(req, trackConcernSchema);
  const { ip } = requestMeta(req);

  const decision = await checkTrackAllowed(ip);
  if (!decision.allowed) {
    throw createApiError.tooManyRequests(
      `Too many lookups. Try again in ${decision.retryAfterSeconds} seconds.`,
      decision.retryAfterSeconds ?? undefined
    );
  }

  const concern = await db.concern.findUnique({
    where: { caseNumber: data.caseNumber },
    select: {
      caseNumber: true,
      title: true,
      status: true,
      priorityLevel: true,
      submittedAt: true,
      updatedAt: true,
      category: { select: { name: true } },
      assignedOffice: { select: { name: true } },
      user: { select: { email: true } },
      history: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true },
      },
    },
  });

  const emailMatches =
    concern?.user.email.toLowerCase() === data.email.toLowerCase();

  if (!concern || !emailMatches) {
    await recordTrackFailure(ip);
    throw createApiError.notFound(LOOKUP_ERROR);
  }

  const lastHistory = concern.history[0]?.createdAt ?? null;
  const lastUpdatedAt =
    lastHistory && lastHistory > concern.updatedAt
      ? lastHistory
      : concern.updatedAt;

  return ok({
    caseNumber: concern.caseNumber,
    title: concern.title,
    status: concern.status,
    statusLabel: statusLabel(concern.status),
    priorityLevel: concern.priorityLevel,
    category: concern.category.name,
    assignedOffice: concern.assignedOffice?.name ?? null,
    submittedAt: concern.submittedAt.toISOString(),
    lastUpdatedAt: lastUpdatedAt.toISOString(),
  });
});
