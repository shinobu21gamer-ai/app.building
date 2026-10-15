import Link from "next/link";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PrintButton } from "@/components/ui/print-button";
import { StatCard } from "@/components/dashboard/stat-card";
import { copy, type Locale } from "@/lib/i18n";
import { todayManila } from "@/lib/cases/action-date";
import type { ReportTabKey } from "@/lib/reports/catalog";
import type { ReportDocument } from "@/lib/reports/document";
import { generatedAtLabel, reportRangeLabel } from "@/lib/reports/labels";
import { REPORT_PERIOD_KEYS } from "@/lib/reports/period";

/**
 * One renderer for every report.
 *
 * The document shape (stats → sections → rows) is produced by the loaders, so
 * this component never learns what a treasury report is: adding a fifth report
 * means adding a loader, not a screen.
 */

/** The period picker: a plain GET form, so a chosen window is a shareable URL. */
export function ReportPeriodPicker({
  basePath,
  locale,
  period,
  from,
  to,
  exportHref,
  extraParams,
}: {
  basePath: string;
  locale: Locale;
  period: string;
  from: string;
  to: string;
  exportHref: string;
  /** Carried through the form (e.g. `?report=treasury` on the captain page). */
  extraParams?: Record<string, string>;
}) {
  const t = copy[locale].revamp.reports;

  return (
    <Card className="no-print">
      <form
        method="get"
        action={basePath}
        className="flex flex-wrap items-end gap-3"
      >
        {Object.entries(extraParams ?? {}).map(([key, value]) => (
          <input key={key} type="hidden" name={key} value={value} />
        ))}

        <div className="min-w-[12rem] grow sm:grow-0">
          <label htmlFor="report-period" className="block text-sm font-medium text-ink">
            {t.period}
          </label>
          <select
            id="report-period"
            name="period"
            defaultValue={period}
            className="mt-1 w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-sm text-ink"
          >
            {REPORT_PERIOD_KEYS.map((key) => (
              <option key={key} value={key}>
                {t.periods[key]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="report-from" className="block text-sm font-medium text-ink">
            {t.from}
          </label>
          <input
            id="report-from"
            type="date"
            name="from"
            defaultValue={from}
            max={todayManila()}
            className="mt-1 rounded-control border border-line-strong bg-surface px-3 py-2 text-sm text-ink"
          />
        </div>

        <div>
          <label htmlFor="report-to" className="block text-sm font-medium text-ink">
            {t.to}
          </label>
          <input
            id="report-to"
            type="date"
            name="to"
            defaultValue={to}
            max={todayManila()}
            className="mt-1 rounded-control border border-line-strong bg-surface px-3 py-2 text-sm text-ink"
          />
        </div>

        <Button type="submit" size="sm">
          {t.apply}
        </Button>

        <span className="grow" />

        <div className="flex flex-wrap gap-2">
          <PrintButton label={t.print} />
          <Button href={exportHref} variant="secondary" size="sm">
            <Download size={14} aria-hidden="true" />
            {t.csv}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** Tabs between the reports a role can open. A single report renders no tabs. */
export function ReportTabs({
  locale,
  tabs,
  active,
}: {
  locale: Locale;
  tabs: { key: ReportTabKey; href: string }[];
  active: string;
}) {
  const t = copy[locale].revamp.reports;
  if (tabs.length <= 1) return null;

  return (
    <nav className="no-print flex flex-wrap gap-2" aria-label={t.title}>
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={tab.key === active ? "page" : undefined}
          className={
            tab.key === active
              ? "rounded-control bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white"
              : "rounded-control border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-muted"
          }
        >
          {t.tabs[tab.key]}
        </Link>
      ))}
    </nav>
  );
}

/** Stats, then one table per section. Everything on screen is in the export. */
export function ReportView({
  document,
  locale,
  exportHref,
}: {
  document: ReportDocument;
  locale: Locale;
  exportHref?: string;
}) {
  const t = copy[locale].revamp.reports;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-caption uppercase tracking-wide text-ink-subtle">
          {reportRangeLabel(locale, document.period)}
        </p>
        <h2 className="text-subtitle text-ink">{document.title}</h2>
        {document.description ? (
          <p className="mt-1 max-w-3xl text-sm text-ink-subtle">
            {document.description}
          </p>
        ) : null}
        <p className="mt-1 text-caption text-ink-subtle">
          {t.generatedAt.replace("{date}", generatedAtLabel(document.generatedAt))}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {document.stats.map((stat) => (
          <StatCard
            key={stat.label}
            label={stat.label}
            value={stat.value}
            hint={stat.hint}
            tone={stat.tone ?? "default"}
          />
        ))}
      </div>

      {document.sections.map((section) => (
        <Card
          key={section.key}
          title={section.title}
          description={section.description}
        >
          {section.rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-subtle">{t.noData}</p>
          ) : (
            <div className="overflow-x-auto">
              <table data-stack className="w-full min-w-[560px] text-left text-sm">
                <caption className="sr-only">{section.title}</caption>
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-subtle">
                    {section.columns.map((column) => (
                      <th
                        key={column.key}
                        scope="col"
                        className={
                          column.align === "right"
                            ? "py-2 pl-3 text-right font-semibold"
                            : "py-2 pr-3 font-semibold"
                        }
                      >
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {section.rows.map((row, index) => {
                    const bar = section.bars?.[index];
                    return (
                      <tr key={index}>
                        {section.columns.map((column, columnIndex) => (
                          <td
                            key={column.key}
                            data-label={column.label}
                            className={
                              column.align === "right"
                                ? "py-2 pl-3 text-right tabular-nums text-ink"
                                : "py-2 pr-3 text-ink"
                            }
                          >
                            {String(row[column.key] ?? "—")}
                            {bar && columnIndex === 0 ? (
                              <span
                                aria-hidden="true"
                                className="mt-1 block h-1 w-full max-w-[8rem] rounded-full bg-surface-sunken"
                              >
                                <span
                                  className="block h-1 rounded-full bg-brand-500"
                                  style={{
                                    width: `${Math.max(0, Math.min(100, bar.share))}%`,
                                  }}
                                />
                              </span>
                            ) : null}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ))}

      <p className="text-caption text-ink-subtle">
        {exportHref ? t.exportedHint : null}
      </p>
    </div>
  );
}
