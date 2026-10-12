import type { Metadata } from "next";

import { ReportScreen, reportsExportHref } from "@/components/reports/report-screen";
import { requirePermission } from "@/lib/auth/session";
import { reportTabs } from "@/lib/reports/catalog";
import { resolveReportPeriod } from "@/lib/reports/period";
import { getLocale } from "@/lib/locale";
import { firstParam } from "@/lib/utils";
import { loadTreasuryReport } from "@/lib/reports/treasury";

export const metadata: Metadata = {
  title: "Treasury report",
  description: "MOOE utilisation, the disbursement register and liquidation aging.",
};

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requirePermission("report.view.treasury");
  const locale = await getLocale();
  const params = await searchParams;
  const period = resolveReportPeriod({
    period: firstParam(params, "period"),
    from: firstParam(params, "from"),
    to: firstParam(params, "to"),
  });
  const document = await loadTreasuryReport({
    locale,
    period,
    actor: { id: user.id, roleKey: user.role.key, officeId: user.officeId },
  });
  return (
    <ReportScreen
      locale={locale}
      title={document.title}
      description={document.description}
      document={document}
      basePath="/admin/reports/treasury"
      tabs={reportTabs("/admin/reports", ["concerns", "engineering", "treasury", "privacy", "transparency"])}
      active="treasury"
      exportHref={reportsExportHref("treasury", period)}
    />
  );
}
