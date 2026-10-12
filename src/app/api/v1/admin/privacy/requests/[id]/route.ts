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
import { handleDataSubjectRequest } from "@/lib/privacy/service";
import { dsrUpdateSchema } from "@/lib/validations/privacy";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw createApiError.notFound("Request not found.");
  }
  return id;
}

/**
 * PATCH /api/v1/admin/privacy/requests/[id]
 * Handles a data subject request. Completing an ERASURE request anonymises the
 * resident in the same transaction and writes an ErasureExecution record, so a
 * request can never be marked done while the data is still there.
 */
export const PATCH = withErrorBoundary<[Request, RouteContext]>(
  async (req, ctx) => {
    assertSameOrigin(req);
    const actor = await requireApiPermission("privacy.dsr.handle");
    const id = parseId((await ctx.params).id);
    const body = await parseBody(req, dsrUpdateSchema);

    const row = await handleDataSubjectRequest({
      id,
      actorId: actor.id,
      status: body.status,
      resolutionNotes: body.resolutionNotes ?? null,
      denialReason: body.denialReason ?? null,
    });

    const meta = requestMeta(req);
    await recordAudit({
      action: `DSR_${body.status}`,
      resourceType: "data_subject_request",
      resourceId: row.referenceCode,
      description: `Marked ${dsrTypeLabel(row.type)} request ${row.referenceCode} as ${dsrStatusLabel(row.status)}.`,
      userId: actor.id,
      ...meta,
    });

    return ok({
      request: {
        id: row.id,
        referenceCode: row.referenceCode,
        type: row.type,
        status: row.status,
        statusLabel: dsrStatusLabel(row.status),
        resolvedAt: row.resolvedAt,
        resolutionNotes: row.resolutionNotes,
        denialReason: row.denialReason,
      },
    });
  }
);
