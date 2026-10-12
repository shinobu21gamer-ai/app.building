import type { Metadata } from "next";

import { ReportScreen, reportsExportHref } from "@/components/reports/report-screen";
import { requirePermission } from "@/lib/auth/session";
import { reportTabs } from "@/lib/reports/catalog";
import { resolveReportPeriod } from "@/lib/reports/period";
import { getLocale } from "@/lib/locale";
import { firstParam } from "@/lib/utils";
import { loadEngineeringReport } from "@/lib/reports/engineering";

export const metadata: Metadata = {
  title: "Engineering report",
  description: "Case volume, turnaround, SLA compliance and crew workload.",
};

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requirePermission("report.view.all");
  const locale = await getLocale();
  const params = await searchParams;
  const period = resolveReportPeriod({
    period: firstParam(params, "period"),
    from: firstParam(params, "from"),
    to: firstParam(params, "to"),
  });
  const document = await loadEngineeringReport({ locale, period, officeId: null });
  return (
    <ReportScreen
      locale={locale}
      title={document.title}
      description={document.description}
      document={document}
      basePath="/admin/reports/engineering"
      tabs={reportTabs("/admin/reports", ["concerns", "engineering", "treasury", "privacy", "transparency"])}
      active="engineering"
      exportHref={reportsExportHref("engineering", period)}
    />
  );
}
