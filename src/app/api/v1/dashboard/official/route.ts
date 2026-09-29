import { ok, withErrorBoundary } from "@/lib/api";
import { requireApiRole } from "@/lib/auth/session";
import { parseConcernFilters } from "@/lib/cases/query";
import { getOfficialDashboard } from "@/lib/dashboards/official";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/dashboard/official
 * Office-scoped workload figures plus the searchable/filterable case list.
 * Supports `q`, `status`, `priority`, `categoryId`, `officeId`, `from`, `to`.
 */
export const GET = withErrorBoundary(async (req: Request) => {
  const user = await requireApiRole(["OFFICIAL", "ADMIN"]);
  const { searchParams } = new URL(req.url);
  const filters = parseConcernFilters(searchParams);

  // Officials are always locked to their own office; administrators may scope
  // to a single office or leave it unfiltered.
  const officeId =
    user.role.key === "OFFICIAL" ? (user.officeId ?? -1) : null;

  return ok(await getOfficialDashboard(officeId, filters));
});
