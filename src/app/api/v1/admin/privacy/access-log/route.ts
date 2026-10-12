import { ok, withErrorBoundary } from "@/lib/api";
import { requireApiPermission } from "@/lib/auth/session";
import { recentPiiAccessLog } from "@/lib/privacy/service";

export const runtime = "nodejs";

/**
 * GET /api/v1/admin/privacy/access-log
 * The most recent unmaskings of personal data: who looked, at whose record,
 * for which field, and the reason they gave.
 */
export const GET = withErrorBoundary(async (req: Request) => {
  await requireApiPermission("privacy.pii_access.view");

  const { searchParams } = new URL(req.url);
  const takeRaw = Number(searchParams.get("take") ?? 100);
  const take = Number.isFinite(takeRaw)
    ? Math.min(Math.max(Math.trunc(takeRaw), 1), 500)
    : 100;

  const rows = await recentPiiAccessLog(take);

  return ok({
    entries: rows.map((row) => ({
      id: row.id,
      field: row.field,
      purpose: row.purpose,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      createdAt: row.createdAt,
      actor: row.actor
        ? {
            id: row.actor.id,
            name: `${row.actor.firstName} ${row.actor.lastName}`.trim(),
            email: row.actor.email,
          }
        : null,
      subject: row.subjectUser
        ? {
            id: row.subjectUser.id,
            name: `${row.subjectUser.firstName} ${row.subjectUser.lastName}`.trim(),
          }
        : null,
    })),
  });
});
