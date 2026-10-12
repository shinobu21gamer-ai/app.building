import { createApiError, ok, withErrorBoundary } from "@/lib/api";
import { requireApiPermission } from "@/lib/auth/session";
import {
  auditChainStatus,
  auditDigest,
  auditFacets,
  listAuditEntries,
  serializeAuditEntry,
  serializeChainStatus,
} from "@/lib/audit/store";

export const runtime = "nodejs";

function numberParam(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function dateParam(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw createApiError.badRequest("Dates must be ISO strings (YYYY-MM-DD).");
  }
  return parsed;
}

/**
 * GET /api/v1/admin/audit
 * The audit trail plus the chain's verification state. `?digest=1` returns the
 * printable digest of the last verification run instead of the rows.
 */
export const GET = withErrorBoundary<[Request]>(async (req) => {
  await requireApiPermission("admin.audit.view");
  const url = new URL(req.url);

  if (url.searchParams.get("digest") === "1") {
    const digest = await auditDigest();
    return ok({
      lines: digest.lines,
      run: digest.run
        ? {
            id: digest.run.id,
            status: digest.run.status,
            startedAt: digest.run.startedAt.toISOString(),
            finishedAt: digest.run.finishedAt?.toISOString() ?? null,
            checkedCount: digest.run.checkedCount,
            triggeredBy: digest.run.triggeredBy,
          }
        : null,
      chain: serializeChainStatus(digest.status),
    });
  }

  const chainedParam = url.searchParams.get("chained");
  const [status, facets, listing] = await Promise.all([
    auditChainStatus(),
    auditFacets(),
    listAuditEntries({
      q: url.searchParams.get("q"),
      action: url.searchParams.get("action"),
      resourceType: url.searchParams.get("resourceType"),
      resourceId: url.searchParams.get("resourceId"),
      actorRole: url.searchParams.get("actorRole"),
      chained: chainedParam === null ? null : chainedParam !== "false",
      from: dateParam(url.searchParams.get("from")),
      to: dateParam(url.searchParams.get("to")),
      limit: numberParam(url.searchParams.get("limit"), 50),
      offset: numberParam(url.searchParams.get("offset"), 0),
    }),
  ]);

  return ok({
    chain: serializeChainStatus(status),
    facets,
    entries: listing.rows.map(serializeAuditEntry),
    total: listing.total,
  });
});
