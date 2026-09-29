import { assertSameOrigin, ok, withErrorBoundary } from "@/lib/api";
import { requireApiRole } from "@/lib/auth/session";
import { retryPendingEmailDeliveries } from "@/lib/email";

export const runtime = "nodejs";

export const POST = withErrorBoundary(async (req: Request) => {
  assertSameOrigin(req);
  await requireApiRole(["ADMIN"]);
  return ok({ sent: await retryPendingEmailDeliveries() });
});