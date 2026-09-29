import { db } from "@/lib/db";

// Resolved/closed cases are considered finished; everything else is active.
const FINISHED = ["RESOLVED", "CLOSED"] as const;

/**
 * Resident dashboard statistics. Every number is computed from the database
 * for the signed-in resident only, so the figures always follow the records.
 */
export async function getResidentDashboard(userId: number) {
  const [
    total,
    active,
    resolved,
    recent,
    notifications,
    unreadNotifications,
  ] = await Promise.all([
    db.concern.count({ where: { userId } }),
    db.concern.count({
      where: { userId, status: { notIn: [...FINISHED] } },
    }),
    db.concern.count({
      where: { userId, status: { in: [...FINISHED] } },
    }),
    db.concern.findMany({
      where: { userId },
      select: {
        id: true,
        caseNumber: true,
        title: true,
        status: true,
        priorityLevel: true,
        createdAt: true,
        updatedAt: true,
        category: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    db.notification.findMany({
      where: { userId },
      select: {
        id: true,
        concernId: true,
        type: true,
        title: true,
        message: true,
        isRead: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    db.notification.count({ where: { userId, isRead: false } }),
  ]);

  return {
    totals: { total, active, resolved },
    recent,
    notifications,
    unreadNotifications,
  };
}
