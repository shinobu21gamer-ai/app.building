import { ok, withErrorBoundary } from "@/lib/api";
import { requireApiPermission } from "@/lib/auth/session";
import { listIdentityQueue, identityQueueCounts } from "@/lib/identity/verification";

export const runtime = "nodejs";

/**
 * GET /api/v1/admin/identity?status=&q=
 * The ID verification queue. Staff never see the ID number: only the stored
 * last four characters and the attached image are exposed.
 */
export const GET = withErrorBoundary(async (req: Request) => {
  await requireApiPermission("privacy.identity.review");

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status")?.trim().toUpperCase() || null;
  const q = searchParams.get("q")?.trim() || null;

  const [rows, counts] = await Promise.all([
    listIdentityQueue({ status, q }),
    identityQueueCounts(),
  ]);

  return ok({
    counts,
    submissions: rows.map((row) => ({
      userId: row.userId,
      status: row.status,
      method: row.method,
      idTypeLabel: row.idTypeLabel,
      idNumberLast4: row.idNumberLast4,
      hasIdImage: Boolean(row.idImageUrl),
      // The filename-based URL only; opening it is permission-checked and
      // logged by /api/v1/uploads/[filename].
      idImageUrl: row.idImageUrl,
      hasSelfie: Boolean(row.selfieUrl),
      submittedAt: row.submittedAt,
      reviewedAt: row.reviewedAt,
      decisionReason: row.decisionReason,
      verifiedAt: row.verifiedAt,
      expiresAt: row.expiresAt,
      reviewedBy: row.reviewedBy
        ? {
            id: row.reviewedBy.id,
            name: `${row.reviewedBy.firstName} ${row.reviewedBy.lastName}`.trim(),
          }
        : null,
      resident: {
        id: row.user.id,
        name: `${row.user.firstName} ${row.user.lastName}`.trim(),
        email: row.user.email,
        address: row.user.address,
        isActive: row.user.isActive,
        role: row.user.role?.key ?? null,
        office: row.user.office?.name ?? null,
      },
    })),
  });
});
