import { ok, withErrorBoundary } from "@/lib/api";
import { requireApiRole } from "@/lib/auth/session";
import { getAdminDashboard } from "@/lib/dashboards/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/dashboard/admin
 * System-wide aggregates computed live from the database.
 */
export const GET = withErrorBoundary(async () => {
  await requireApiRole(["ADMIN"]);
  return ok(await getAdminDashboard());
});
