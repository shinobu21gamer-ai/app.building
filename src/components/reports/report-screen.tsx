import { PageHeader } from "@/components/ui/page-header";
import {
  ReportPeriodPicker,
  ReportTabs,
  ReportView,
} from "@/components/reports/report-view";
import { copy, type Locale } from "@/lib/i18n";
import type { ReportDocument } from "@/lib/reports/document";
import { dayInputValue } from "@/lib/reports/labels";
import type { ReportKey, ReportTabKey } from "@/lib/reports/catalog";

/**
 * The chrome every report page shares: a role-aware title, the period picker,
 * the tab strip between reports, and the document itself.
 *
 * The page keeps the interesting parts — who may look, and which scope their
 * data comes from — and hands the finished document here. That split is why
 * the same component renders an office-scoped engineering report for an
 * official and a barangay-wide one for the captain.
 */

export function reportsExportHref(
  reportKey: ReportKey,
  period: ReportDocument["period"],
  extra: Record<string, string> = {}
): string {
  const query = new URLSearchParams({
    format: "csv",
    period: period.key,
  });
  if (period.from) query.set("from", dayInputValue(period.from));
  if (period.to) query.set("to", dayInputValue(period.to));
  for (const [key, value] of Object.entries(extra)) query.set(key, value);
  return `/api/v1/reports/${reportKey}?${query.toString()}`;
}

export function ReportScreen({
  locale,
  title,
  description,
  document,
  basePath,
  tabs,
  active,
  exportHref,
  children,
}: {
  locale: Locale;
  title: string;
  description?: React.ReactNode;
  document: ReportDocument;
  basePath: string;
  tabs?: { key: ReportTabKey; href: string }[];
  active?: ReportTabKey;
  exportHref: string;
  /** Anything the role needs above the period picker, e.g. the admin filters. */
  children?: React.ReactNode;
}) {
  const t = copy[locale].revamp.reports;

  return (
    <div className="space-y-6">
      <PageHeader title={title} description={description} />

      {tabs && active ? (
        <ReportTabs locale={locale} tabs={tabs} active={active} />
      ) : null}

      <ReportPeriodPicker
        basePath={basePath}
        locale={locale}
        period={document.period.key}
        from={dayInputValue(document.period.from)}
        to={dayInputValue(document.period.to)}
        exportHref={exportHref}
      />

      {children}

      <ReportView document={document} locale={locale} exportHref={exportHref} />

      <p className="text-caption text-ink-subtle">{t.hubLead}</p>
    </div>
  );
}
