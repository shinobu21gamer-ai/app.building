import type { Metadata } from "next";
import { Container } from "@/components/ui/container";
import { Card } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";
import { formatDateTime } from "@/lib/format";
import { SecurityReportReview } from "@/components/admin/security-report-review";

export const metadata: Metadata = { title: "Sign-in security reports" };

export default async function SecurityReportsPage() {
  await requireRole(["ADMIN"]);
  const locale = await getLocale();
  const t = copy[locale].admin;
  const reports = await db.loginSecurityReport.findMany({
    orderBy: [{ reviewedAt: "asc" }, { responseDueAt: "asc" }],
    take: 100,
  });

  return (
    <Container className="space-y-6 py-8">
      <header>
        <h1 className="text-title text-ink sm:text-display">{t.securityReportsTitle}</h1>
        <p className="mt-2 text-sm text-ink-muted">{t.securityReportsDesc}</p>
      </header>
      {reports.length === 0 ? (
        <Card><p className="py-4 text-center text-sm text-ink-muted">{t.securityReportEmpty}</p></Card>
      ) : (
        <ul className="space-y-3">
          {reports.map((report) => {
            const overdue = !report.reviewedAt && report.responseDueAt.getTime() <= Date.now();
            return (
              <li key={report.id} id={`report-${report.id}`}>
                <Card className={overdue ? "border-amber-300" : undefined}>
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-1">
                      <h2 className="font-semibold text-ink">{report.reportedEmail}</h2>
                      <p className="text-sm text-ink-subtle">
                        {t.securityReportReported.replace("{date}", formatDateTime(report.reportedAt))}
                      </p>
                      <p className={overdue ? "text-sm font-semibold text-amber-800" : "text-sm text-ink-muted"}>
                        {t.securityReportDeadline.replace("{date}", formatDateTime(report.responseDueAt))}
                        {overdue ? ` · ${t.securityReportOverdue}` : ""}
                      </p>
                    </div>
                    <SecurityReportReview
                      reportId={report.id}
                      reviewed={report.reviewedAt !== null}
                      locale={locale}
                    />
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </Container>
  );
}
