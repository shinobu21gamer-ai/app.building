import { db } from "@/lib/db";

export const ALERT_REACTIONS = ["ACKNOWLEDGED", "HELPFUL", "NEED_HELP"] as const;

export function alertView(alert: {
  id: number;
  title: string;
  message: string;
  severity: string;
  sound: boolean;
  createdAt: Date;
  expiresAt: Date | null;
  reactions: { reaction: string }[];
  acknowledgements: { userId: number }[];
}, userId: number) {
  const counts = Object.fromEntries(
    ALERT_REACTIONS.map((reaction) => [
      reaction,
      alert.reactions.filter((entry) => entry.reaction === reaction).length,
    ])
  );
  return {
    id: alert.id,
    title: alert.title,
    message: alert.message,
    severity: alert.severity,
    sound: alert.sound,
    createdAt: alert.createdAt.toISOString(),
    expiresAt: alert.expiresAt?.toISOString() ?? null,
    acknowledged: alert.acknowledgements.some((entry) => entry.userId === userId),
    reactions: counts,
  };
}

export async function getAlertsForUser(userId: number, activeOnly = false) {
  const now = new Date();
  const alerts = await db.systemAlert.findMany({
    where: activeOnly
      ? {
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          acknowledgements: { none: { userId } },
        }
      : {},
    include: {
      reactions: { select: { reaction: true } },
      acknowledgements: { where: { userId }, select: { userId: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return alerts.map((alert) => alertView(alert, userId));
}
