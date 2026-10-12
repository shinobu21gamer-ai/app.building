import type { StatTone } from "@/lib/design/tones";
import { csvCell, csvFilename, toCsv, type CsvValue } from "@/lib/reports/csv";
import type { ReportPeriod } from "@/lib/reports/period";

/**
 * The shape every report returns.
 *
 * One document shape means one screen component, one CSV exporter and one JSON
 * contract for four very different reports. It also keeps the interesting part
 * — the aggregation — in pure functions that unit tests can drive with
 * fixtures, while the loaders stay thin enough to read in one sitting.
 */

export interface ReportColumn {
  key: string;
  label: string;
  align?: "left" | "right";
}

export type ReportCellValue = string | number;

export interface ReportRow {
  [key: string]: ReportCellValue;
}

export interface ReportSection {
  key: string;
  title: string;
  description?: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  /** Optional bar under each row, 0-100, for the tables that read better as a chart. */
  bars?: { key: string; share: number }[];
}

export interface ReportStat {
  label: string;
  value: string | number;
  hint?: string;
  /** Set only where the number itself is a problem (overdue, off-target). */
  tone?: StatTone;
}

export interface ReportDocument {
  key: string;
  title: string;
  description?: string;
  generatedAt: string;
  period: ReportPeriod;
  stats: ReportStat[];
  sections: ReportSection[];
}

/**
 * A query that is capped at `limit` rows. Callers fetch `limit + 1` so they can
 * tell "exactly at the limit" from "more rows exist than were read".
 */
export interface CappedRows<T> {
  rows: T[];
  truncated: boolean;
}

export function capRows<T>(rows: readonly T[], limit: number): CappedRows<T> {
  return { rows: rows.slice(0, limit) as T[], truncated: rows.length > limit };
}

/**
 * Says so on the report when a figure covers only part of the period. A total
 * that silently stops at the limit looks complete, so it must carry a warning.
 */
export function withRowLimitStat(
  document: ReportDocument,
  truncated: boolean,
  labels: { rowLimitLabel: string; rowLimitHint: string },
  limit: number
): ReportDocument {
  if (!truncated) return document;
  return {
    ...document,
    stats: [
      ...document.stats,
      {
        label: labels.rowLimitLabel,
        value: limit.toLocaleString("en-US"),
        hint: labels.rowLimitHint.replace("{limit}", limit.toLocaleString("en-US")),
        tone: "warning",
      },
    ],
  };
}

/** A right-aligned numeric column, the common case in these tables. */
export function numericColumn(key: string, label: string): ReportColumn {
  return { key, label, align: "right" };
}

export function textColumn(key: string, label: string): ReportColumn {
  return { key, label, align: "left" };
}

/** One section as CSV: its column labels, then its rows. */
export function sectionToCsv(section: ReportSection): string {
  return toCsv(
    section.columns.map((column) => column.label),
    section.rows.map((row) =>
      section.columns.map((column) => row[column.key] as CsvValue)
    )
  );
}

/**
 * Every section in one file. Sections are separated by a blank line and a
 * `# title` line, which Excel and Sheets both read as ordinary rows — the
 * alternative (one file per section) means four downloads for one report.
 */
export function documentToCsv(document: ReportDocument): string {
  const blocks: string[] = [];
  for (const section of document.sections) {
    blocks.push(`# ${section.title}`);
    blocks.push(sectionToCsv(section).trimEnd());
    blocks.push("");
  }
  return `${blocks.join("\n")}\n`;
}

/** Header name for the JSON/CSV responses. */
export function reportFilename(document: ReportDocument): string {
  return csvFilename(`${document.key}-${document.period.key}`);
}

/* --------------------------------------------------------------- cells */

/** An integer, or an em dash when the figure does not exist. */
export function count(value: number | null | undefined): number | string {
  return typeof value === "number" && Number.isFinite(value) ? value : "—";
}

/** One decimal place: these reports count things, they do not weigh them. */
export function decimal(value: number | null | undefined): number | string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return Math.round(value * 10) / 10;
}

/** A percentage, e.g. "62.5%". */
export function percent(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${(Math.round(value * 10) / 10).toString()}%`;
}

/** A share of a whole (0-100), or null when the whole is zero. */
export function sharePercent(part: number, whole: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return null;
  return (part / whole) * 100;
}

/** Pesos with two decimals: treasury figures are money. */
export function peso(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `₱${value.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** The `YYYY-MM-DD` day, for a date cell. */
export function day(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const iso = value instanceof Date ? value.toISOString() : value;
  return iso.slice(0, 10);
}

/** "Sep 2026" for a `YYYY-MM` month bucket. */
export function monthLabel(month: string): string {
  const [year, monthNumber] = month.split("-");
  const names = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const index = Number(monthNumber) - 1;
  return `${names[index] ?? monthNumber ?? "?"} ${year ?? ""}`.trim();
}

/** Coerces a value to a numeric cell, so a missing figure renders as 0, not NaN. */
export function numberCell(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export { csvCell };
