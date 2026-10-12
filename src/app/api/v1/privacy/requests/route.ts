import {
  assertSameOrigin,
  createApiError,
  ok,
  parseBody,
  withErrorBoundary,
} from "@/lib/api";
import { requireApiPermission } from "@/lib/auth/session";
import { recordAudit, requestMeta } from "@/lib/audit";
import { dsrStatusLabel, dsrTypeLabel } from "@/lib/privacy/catalog";
import { dsrDeadlineLabel } from "@/lib/privacy/dates";
import {
  countRecentDsr,
  createDataSubjectRequest,
  listMyDataSubjectRequests,
} from "@/lib/privacy/service";
import { dsrCreateSchema } from "@/lib/validations/privacy";

export const runtime = "nodejs";

/**
 * Requests a resident may file per 24 hours. Counted from the request table
 * itself so the limit cannot be gamed by switching networks, and so it never
 * consumes the shared login/registration throttle bucket.
 */
const DSR_MAX_PER_DAY = 5;

function dsrView(row: {
  id: number;
  referenceCode: string;
  type: string;
  status: string;
  requestedAt: Date;
  dueAt: Date | null;
  resolvedAt: Date | null;
  details: string | null;
  resolutionNotes: string | null;
  denialReason: string | null;
}) {
  return {
    id: row.id,
    referenceCode: row.referenceCode,
    type: row.type,
    typeLabel: dsrTypeLabel(row.type),
    status: row.status,
    statusLabel: dsrStatusLabel(row.status),
    requestedAt: row.requestedAt,
    dueAt: row.dueAt,
    resolvedAt: row.resolvedAt,
    details: row.details,
    resolutionNotes: row.resolutionNotes,
    denialReason: row.denialReason,
    overdue:
      row.dueAt !== null &&
      row.resolvedAt === null &&
      row.dueAt.getTime() < Date.now(),
  };
}

/**
 * GET /api/v1/privacy/requests
 * The signed-in user's own data subject requests.
 */
export const GET = withErrorBoundary(async () => {
  const user = await requireApiPermission("privacy.dsr.create");
  const rows = await listMyDataSubjectRequests(user.id);

  return ok({
    requests: rows.map(dsrView),
    deadline: dsrDeadlineLabel(),
  });
});

/**
 * POST /api/v1/privacy/requests
 * Files a data subject request (access, correction, erasure, …). The resident
 * gets a reference code and the statutory deadline is recorded.
 */
export const POST = withErrorBoundary(async (req: Request) => {
  assertSameOrigin(req);
  const user = await requireApiPermission("privacy.dsr.create");
  const meta = requestMeta(req);
  const body = await parseBody(req, dsrCreateSchema);

  if ((await countRecentDsr(user.id)) >= DSR_MAX_PER_DAY) {
    throw createApiError.tooManyRequests(
      `You have already filed ${DSR_MAX_PER_DAY} requests today. Call the barangay hall if it is urgent.`
    );
  }

  const request = await createDataSubjectRequest({
    userId: user.id,
    type: body.type,
    details: body.details ?? null,
  });

  await recordAudit({
    action: "DSR_CREATED",
    resourceType: "data_subject_request",
    resourceId: request.referenceCode,
    description: `Filed a ${body.type} request (${request.referenceCode}).`,
    userId: user.id,
    ...meta,
  });

  return ok(
    {
      request: dsrView(request),
      deadline: dsrDeadlineLabel(),
    },
    { status: 201 }
  );
});
