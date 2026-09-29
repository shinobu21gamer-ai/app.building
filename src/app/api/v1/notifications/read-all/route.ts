import { assertSameOrigin, ok, withErrorBoundary } from "@/lib/api";
import { requireApiRole } from "@/lib/auth/session";
import {
  countUnreadNotifications,
  markAllNotificationsRead,
} from "@/lib/notifications/query";

export const runtime = "nodejs";

/**
 * POST /api/v1/notifications/read-all
 * Marks every unread notification for the signed-in user as read.
 */
export const POST = withErrorBoundary(async (req: Request) => {
  assertSameOrigin(req);
  const user = await requireApiRole(["RESIDENT", "OFFICIAL", "ADMIN"]);

  const updated = await markAllNotificationsRead(user.id);
  const unreadCount = await countUnreadNotifications(user.id);

  return ok({ updated, unreadCount });
});
