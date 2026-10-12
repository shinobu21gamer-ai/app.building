import type { Metadata } from "next";

import { ReportScreen, reportsExportHref } from "@/components/reports/report-screen";
import { requirePermission } from "@/lib/auth/session";
import { reportTabs } from "@/lib/reports/catalog";
import { resolveReportPeriod } from "@/lib/reports/period";
import { getLocale } from "@/lib/locale";
import { firstParam } from "@/lib/utils";
import { loadPrivacyReport } from "@/lib/reports/privacy";

export const metadata: Metadata = {
  title: "Privacy report",
  description: "Data subject requests, consents, personal-data access and retention.",
};

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requirePermission("privacy.pii_access.view");
  const locale = await getLocale();
  const params = await searchParams;
  const period = resolveReportPeriod({
    period: firstParam(params, "period"),
    from: firstParam(params, "from"),
    to: firstParam(params, "to"),
  });
  const document = await loadPrivacyReport({ locale, period });
  return (
    <ReportScreen
      locale={locale}
      title={document.title}
      description={document.description}
      document={document}
      basePath="/admin/reports/privacy"
      tabs={reportTabs("/admin/reports", ["concerns", "engineering", "treasury", "privacy", "transparency"])}
      active="privacy"
      exportHref={reportsExportHref("privacy", period)}
    />
  );
}
