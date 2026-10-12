import { copy, statusLabelFor, type Locale } from "@/lib/i18n";
import { dayKeyOf, type ReportPeriod } from "@/lib/reports/period";
import { formatDate, formatDateTime } from "@/lib/format";

/**
 * Report wording, in one place.
 *
 * The loaders take a `ReportLabels` object rather than importing `copy`
 * directly: the builders stay pure (a test can pass a stub), the screens pass
 * the real copy, and a missing translation becomes a compile error because the
 * type is derived from the English block.
 */

export type ReportLabels = (typeof copy)["en"]["revamp"]["reports"];

export function reportLabels(locale: Locale): ReportLabels {
  return copy[locale].revamp.reports;
}

/** Case status in words: "UNDER_ASSESSMENT" → "Under assessment". */
export function statusText(locale: Locale, status: string): string {
  return statusLabelFor(locale, status);
}

/** The period's own label, e.g. "Last 90 days". */
export function periodLabel(locale: Locale, period: ReportPeriod): string {
  return copy[locale].revamp.reports.periods[period.key];
}

/**
 * A concrete description of the window: the label plus the dates it covers, use
 * Manila days, matching the boundaries the queries use.
 */
export function reportRangeLabel(locale: Locale, period: ReportPeriod): string {
  const label = periodLabel(locale, period);
  if (!period.from && !period.to) return label;
  const from = period.from ? formatDate(period.from) : "…";
  const to = period.to ? formatDate(period.to) : "…";
  return `${label} (${from} – ${to})`;
}

/** `2026-10-12`, the form the period picker's date inputs expect. */
export function dayInputValue(value: Date | null): string {
  return value ? dayKeyOf(value) : "";
}

/** "Generated 12 Oct 2026, 14:05" for the report header. */
export function generatedAtLabel(generatedAt: string): string {
  return formatDateTime(new Date(generatedAt));
}
