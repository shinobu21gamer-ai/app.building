import type { Metadata } from "next";

import { ReportScreen, reportsExportHref } from "@/components/reports/report-screen";
import { requirePermission } from "@/lib/auth/session";
import { reportTabs } from "@/lib/reports/catalog";
import { resolveReportPeriod } from "@/lib/reports/period";
import { getLocale } from "@/lib/locale";
import { firstParam } from "@/lib/utils";
import { loadEngineeringReport } from "@/lib/reports/engineering";

export const metadata: Metadata = {
  title: "Office reports",
  description: "Case volume, turnaround, SLA compliance and crew workload for your office.",
};

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requirePermission("report.view.office");
  const locale = await getLocale();
  const params = await searchParams;
  const period = resolveReportPeriod({
    period: firstParam(params, "period"),
    from: firstParam(params, "from"),
    to: firstParam(params, "to"),
  });
  const document = await loadEngineeringReport({
    locale,
    period,
    // An official with no office gets an empty report rather than the whole
    // barangay: `-1` matches nothing, which is the safe way to say "no scope".
    officeId: user.officeId ?? -1,
  });
  return (
    <ReportScreen
      locale={locale}
      title={document.title}
      description={document.description}
      document={document}
      basePath="/official/reports"
      tabs={reportTabs("/official/reports", ["engineering"])}
      active="engineering"
      exportHref={reportsExportHref("engineering", period)}
    />
  );
}
