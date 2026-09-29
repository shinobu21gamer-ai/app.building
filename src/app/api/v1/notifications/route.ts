import { ok, withErrorBoundary } from "@/lib/api";
import { requireApiRole } from "@/lib/auth/session";
import {
  countUnreadNotifications,
  listNotifications,
  notificationView,
  parseNotificationFilters,
} from "@/lib/notifications/query";

export const runtime = "nodejs";

/**
 * GET /api/v1/notifications?unread=true&concernId=&limit=
 * Lists the signed-in user's notifications with the related case summary.
 */
export const GET = withErrorBoundary(async (req: Request) => {
  const user = await requireApiRole(["RESIDENT", "OFFICIAL", "ADMIN"]);
  const { searchParams } = new URL(req.url);
  const filters = parseNotificationFilters(searchParams);

  const [notifications, unreadCount] = await Promise.all([
    listNotifications(user.id, filters),
    countUnreadNotifications(user.id),
  ]);

  return ok({
    notifications: notifications.map(notificationView),
    unreadCount,
  });
});
