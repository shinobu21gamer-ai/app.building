import { ok, withErrorBoundary } from "@/lib/api";
import { requireApiRole } from "@/lib/auth/session";
import { getResidentDashboard } from "@/lib/dashboards/resident";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/dashboard/resident
 * Live dashboard figures for the signed-in resident.
 */
export const GET = withErrorBoundary(async () => {
  const user = await requireApiRole(["RESIDENT"]);
  return ok(await getResidentDashboard(user.id));
});
