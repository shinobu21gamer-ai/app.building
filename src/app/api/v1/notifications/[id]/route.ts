import {
  assertSameOrigin,
  createApiError,
  ok,
  parseBody,
  withErrorBoundary,
} from "@/lib/api";
import { requireApiRole } from "@/lib/auth/session";
import { notificationUpdateSchema } from "@/lib/validations/notification";
import { markNotificationRead, notificationView } from "@/lib/notifications/query";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * PATCH /api/v1/notifications/[id]
 * Marks one of the signed-in user's notifications read (or unread) and records
 * the read timestamp. Notifications belonging to other users are not found.
 */
export const PATCH = withErrorBoundary<[Request, RouteContext]>(
  async (req, ctx) => {
    assertSameOrigin(req);
    const user = await requireApiRole(["RESIDENT", "OFFICIAL", "ADMIN"]);

    const { id } = await ctx.params;
    const notificationId = Number(id);
    if (!Number.isInteger(notificationId) || notificationId <= 0) {
      throw createApiError.notFound("Notification not found.");
    }

    const body = await parseBody(req, notificationUpdateSchema);
    const updated = await markNotificationRead(
      user.id,
      notificationId,
      body.isRead
    );
    if (!updated) throw createApiError.notFound("Notification not found.");

    return ok({ notification: notificationView(updated) });
  }
);
