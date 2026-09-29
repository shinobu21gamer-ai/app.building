import { ok, withErrorBoundary } from "@/lib/api";
import { publicUser, requireApiUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/auth/me
 * Returns the currently signed-in user, or 401 when not authenticated.
 */
export const GET = withErrorBoundary(async () => {
  const user = await requireApiUser();
  return ok({ user: publicUser(user) });
});