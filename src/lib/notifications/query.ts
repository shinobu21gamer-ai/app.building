import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

type RawParams =
  | URLSearchParams
  | Record<string, string | string[] | undefined>;

function readParam(params: RawParams, key: string): string | null {
  if (params instanceof URLSearchParams) return params.get(key);
  const value = params[key];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function nonEmpty(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export type NotificationFilters = {
  unread: boolean;
  concernId: number | null;
  limit: number;
};

export function parseNotificationFilters(
  params: RawParams
): NotificationFilters {
  const concernRaw = nonEmpty(readParam(params, "concernId"));
  const concernId =
    concernRaw && Number.isInteger(Number(concernRaw)) && Number(concernRaw) > 0
      ? Number(concernRaw)
      : null;

  const limitRaw = Number(nonEmpty(readParam(params, "limit")));
  const limit =
    Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 100;

  return {
    unread: nonEmpty(readParam(params, "unread")) === "true",
    concernId,
    limit,
  };
}

const CONCERN_SELECT = {
  id: true,
  caseNumber: true,
  title: true,
} satisfies Prisma.ConcernSelect;

/**
 * Notifications for one user only. The inbox is always scoped to the
 * signed-in user, so records can never leak across accounts.
 */
export async function listNotifications(
  userId: number,
  filters: NotificationFilters
) {
  const where: Prisma.NotificationWhereInput = { userId };
  if (filters.unread) where.isRead = false;
  if (filters.concernId) where.concernId = filters.concernId;

  return db.notification.findMany({
    where,
    include: { concern: { select: CONCERN_SELECT } },
    orderBy: { createdAt: "desc" },
    take: filters.limit,
  });
}

export async function countUnreadNotifications(userId: number): Promise<number> {
  return db.notification.count({ where: { userId, isRead: false } });
}

/**
 * Marks a single notification read/unread. Returns null when the record does
 * not exist or belongs to someone else, so ownership is enforced here.
 */
export async function markNotificationRead(
  userId: number,
  id: number,
  isRead: boolean
) {
  const existing = await db.notification.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (!existing) return null;

  return db.notification.update({
    where: { id },
    data: { isRead, readAt: isRead ? new Date() : null },
    include: { concern: { select: CONCERN_SELECT } },
  });
}

export async function markAllNotificationsRead(userId: number): Promise<number> {
  const result = await db.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true, readAt: new Date() },
  });
  return result.count;
}

type NotificationRow = Awaited<ReturnType<typeof listNotifications>>[number];

/** Serializes a notification for both server pages and API responses. */
export function notificationView(notification: NotificationRow) {
  return {
    id: notification.id,
    type: notification.type,
    title: notification.title,
    message: notification.message,
    isRead: notification.isRead,
    readAt: notification.readAt ? notification.readAt.toISOString() : null,
    createdAt: notification.createdAt.toISOString(),
    concern: notification.concern
      ? {
          id: notification.concern.id,
          caseNumber: notification.concern.caseNumber,
          title: notification.concern.title,
        }
      : null,
  };
}

export type NotificationView = ReturnType<typeof notificationView>;
