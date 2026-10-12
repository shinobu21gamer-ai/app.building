import { db } from "@/lib/db";
import { ok, withErrorBoundary } from "@/lib/api";
import { requireApiPermission } from "@/lib/auth/session";
import { treasuryDashboard } from "@/lib/treasury/query";

export const runtime = "nodejs";

/**
 * GET /api/v1/treasury/balances
 * Live balances: the barangay totals, the per-allocation figures, what is
 * waiting on an approval and how old the pending vouchers are.
 */
export const GET = withErrorBoundary<[Request]>(
  async (req) => {
    const user = await requireApiPermission("treasury.balance.view");
    const url = new URL(req.url);
    const fiscalYearId = Number(url.searchParams.get("fiscalYearId") ?? "");

    const dashboard = await treasuryDashboard(db, {
      actor: {
        id: user.id,
        roleKey: user.role.key,
        officeId: user.officeId ?? null,
      },
      fiscalYearId:
        Number.isInteger(fiscalYearId) && fiscalYearId > 0 ? fiscalYearId : null,
    });

    return ok(dashboard);
  }
);
