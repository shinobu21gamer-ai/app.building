import { db } from "@/lib/db";
import { HISTORY_ENTRY_SLA_BREACH } from "@/lib/cases/workflow";
import { NOTIFICATION_TYPES } from "@/lib/notifications/service";

export async function scanSlaBreaches(): Promise<number> {
  const now = new Date();
  const overdue = await db.concern.findMany({
    where: {
      slaDueAt: { lt: now },
      slaBreachedAt: null,
      status: { notIn: ["RESOLVED", "CLOSED"] },
    },
    select: {
      id: true,
      caseNumber: true,
      userId: true,
      assignedOfficeId: true,
    },
  });

  for (const concern of overdue) {
    await db.$transaction(async (tx) => {
      const claimed = await tx.concern.updateMany({
        where: { id: concern.id, slaBreachedAt: null },
        data: { slaBreachedAt: now },
      });
      if (claimed.count !== 1) return;

      await tx.caseStatusHistory.create({
        data: {
          concernId: concern.id,
          entryType: HISTORY_ENTRY_SLA_BREACH,
          fromStatus: null,
          toStatus: null,
          remarks: `SLA deadline missed for ${concern.caseNumber}.`,
          actorRole: "SYSTEM",
        },
      });

      await tx.notification.create({
        data: {
          userId: concern.userId,
          concernId: concern.id,
          type: NOTIFICATION_TYPES.SLA_BREACHED,
          title: "Your concern is taking longer than expected",
          message: `Concern ${concern.caseNumber} has passed its service deadline. It remains active and is being monitored.`,
        },
      });

      const admins = await tx.user.findMany({
        where: { isActive: true, role: { key: "ADMIN" } },
        select: { id: true },
      });
      for (const admin of admins) {
        await tx.notification.create({
          data: {
            userId: admin.id,
            concernId: concern.id,
            type: NOTIFICATION_TYPES.SLA_BREACHED,
            title: "Case SLA breached",
            message: `${concern.caseNumber} has passed its SLA deadline and needs attention.`,
          },
        });
      }
    });
  }

  return overdue.length;
}