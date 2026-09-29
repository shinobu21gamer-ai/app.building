import { ok, withErrorBoundary } from "@/lib/api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/health
 * Readiness check: verifies the API is up and the database is reachable.
 */
export const GET = withErrorBoundary(async () => {
  await db.$queryRaw`SELECT 1`;

  return ok({
    status: "ok",
    database: "connected",
    timestamp: new Date().toISOString(),
  });
});