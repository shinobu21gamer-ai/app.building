import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isCronAuthorized } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Unauthorized." } },
      { status: 401 },
    );
  }

  const admins = await db.user.findMany({
    where: { isActive: true, role: { key: "ADMIN" } },
    select: { id: true },
  });
  if (admins.length === 0) {
    return NextResponse.json({ success: true, data: { reminded: 0, skipped: "no_active_admins" } });
  }

  const dueReports = await db.loginSecurityReport.findMany({
    where: {
      reviewedAt: null,
      reminderSentAt: null,
      responseDueAt: { lte: new Date() },
    },
    orderBy: { responseDueAt: "asc" },
    take: 200,
    select: { id: true, reportedEmail: true, responseDueAt: true },
  });

  let reminded = 0;
  for (const report of dueReports) {
    const sentAt = new Date();
    const updated = await db.$transaction(async (tx) => {
      const claimed = await tx.loginSecurityReport.updateMany({
        where: { id: report.id, reviewedAt: null, reminderSentAt: null },
        data: { reminderSentAt: sentAt },
      });
      if (claimed.count !== 1) return false;
      await tx.notification.createMany({
        data: admins.map((admin) => ({
          userId: admin.id,
          concernId: null,
          loginSecurityReportId: report.id,
          type: "LOGIN_SECURITY_REPORT_REMINDER",
          title: "Sign-in report response overdue",
          message: `The unfamiliar sign-in report for ${report.reportedEmail} was due by ${new Intl.DateTimeFormat("en-PH", {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: "Asia/Manila",
          }).format(report.responseDueAt)} Manila time. Please review it. This report is not proof of account ownership.`,
          createdAt: sentAt,
        })),
      });
      return true;
    });
    if (updated) reminded += 1;
  }

  return NextResponse.json({ success: true, data: { reminded } });
}

export const POST = handle;
export const GET = handle;
