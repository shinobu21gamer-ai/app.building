import { db } from "@/lib/db";
import { copy, type Locale } from "@/lib/i18n";
import {
  numericColumn,
  textColumn,
  type ReportDocument,
  type ReportRow,
} from "@/lib/reports/document";
import { reportRangeLabel } from "@/lib/reports/labels";
import { monthKeyOf, monthKeysForPeriod, type ReportPeriod } from "@/lib/reports/period";

/**
 * What the public transparency page shows, summarised for the staff who run it.
 *
 * This report is built from `PublicCaseRecord` — the anonymised projection —
 * and from nothing else. It cannot leak a resident's identity by accident,
 * because the rows it reads do not carry one: no name, no user id, no exact
 * coordinates, no case number.
 */

export const REPORT_ROW_LIMIT = 5000;

export interface PublicCaseRow {
  status: string;
  typeKey: string | null;
  areaLabel: string | null;
  submittedAt: Date;
  resolvedAt: Date | null;
  responseHours: number | null;
  published: boolean;
}

export interface PublicTotals {
  published: number;
  resolved: number;
  resolvedShare: number;
  averageResponseHours: number | null;
  measured: number;
}

export function isPublicResolved(status: string): boolean {
  return status === "RESOLVED" || status === "CLOSED";
}

export function summarizePublic(rows: readonly PublicCaseRow[]): PublicTotals {
  const published = rows.filter((row) => row.published);
  const resolved = published.filter((row) => isPublicResolved(row.status));
  const measured = resolved.filter(
    (row) => typeof row.responseHours === "number" && (row.responseHours ?? -1) >= 0
  );
  const totalHours = measured.reduce((sum, row) => sum + (row.responseHours ?? 0), 0);

  return {
    published: published.length,
    resolved: resolved.length,
    resolvedShare:
      published.length === 0
        ? 0
        : Math.round((resolved.length / published.length) * 1000) / 10,
    averageResponseHours:
      measured.length === 0 ? null : Math.round(totalHours / measured.length),
    measured: measured.length,
  };
}

export interface PublicMonthlyRow {
  month: string;
  published: number;
  resolved: number;
}

/** Cases are counted in the month they were submitted, resolutions in theirs. */
export function summarizePublicMonths(
  rows: readonly PublicCaseRow[],
  months: readonly string[]
): PublicMonthlyRow[] {
  const map = new Map<string, PublicMonthlyRow>(
    months.map((month) => [month, { month, published: 0, resolved: 0 }])
  );

  for (const row of rows) {
    if (!row.published) continue;
    const submitted = map.get(monthKeyOf(row.submittedAt));
    if (submitted) submitted.published += 1;
    if (row.resolvedAt) {
      const resolved = map.get(monthKeyOf(row.resolvedAt));
      if (resolved) resolved.resolved += 1;
    }
  }

  return months.map((month) => map.get(month)!);
}

export interface PublicBreakdownRow {
  key: string;
  name: string;
  count: number;
  resolved: number;
  resolvedShare: number;
}

export function summarizePublicBreakdown(
  rows: readonly PublicCaseRow[],
  pick: (row: PublicCaseRow) => { key: string; name: string } | null,
  limit = 20
): PublicBreakdownRow[] {
  const map = new Map<string, PublicBreakdownRow>();
  for (const row of rows) {
    if (!row.published) continue;
    const picked = pick(row);
    if (!picked) continue;
    const entry = map.get(picked.key) ?? {
      key: picked.key,
      name: picked.name,
      count: 0,
      resolved: 0,
      resolvedShare: 0,
    };
    entry.count += 1;
    if (isPublicResolved(row.status)) entry.resolved += 1;
    map.set(picked.key, entry);
  }

  return [...map.values()]
    .map((entry) => ({
      ...entry,
      resolvedShare:
        entry.count === 0 ? 0 : Math.round((entry.resolved / entry.count) * 1000) / 10,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/* ----------------------------------------------------------------- loaders */

export interface TransparencyReportInput {
  locale: Locale;
  period: ReportPeriod;
}

export interface TransparencyReportData {
  rows: PublicCaseRow[];
  totals: PublicTotals;
  months: PublicMonthlyRow[];
  byType: PublicBreakdownRow[];
  byArea: PublicBreakdownRow[];
  truncated: boolean;
}

export async function loadTransparencyData(
  input: TransparencyReportInput
): Promise<TransparencyReportData> {
  const rows = await db.publicCaseRecord.findMany({
    select: {
      status: true,
      typeKey: true,
      areaLabel: true,
      submittedAt: true,
      resolvedAt: true,
      responseHours: true,
      published: true,
    },
    orderBy: { submittedAt: "desc" },
    take: REPORT_ROW_LIMIT + 1,
  });

  const truncated = rows.length > REPORT_ROW_LIMIT;
  const slice = rows.slice(0, REPORT_ROW_LIMIT) as PublicCaseRow[];

  const typeNames = await db.concernType.findMany({
    select: { key: true, name: true },
  });
  const nameByKey = new Map(typeNames.map((type) => [type.key, type.name]));

  return {
    rows: slice,
    totals: summarizePublic(slice),
    months: summarizePublicMonths(slice, monthKeysForPeriod(input.period)),
    byType: summarizePublicBreakdown(slice, (row) =>
      row.typeKey
        ? { key: row.typeKey, name: nameByKey.get(row.typeKey) ?? row.typeKey }
        : null
    ),
    byArea: summarizePublicBreakdown(slice, (row) =>
      row.areaLabel ? { key: row.areaLabel, name: row.areaLabel } : null
    ),
    truncated,
  };
}

/* ------------------------------------------------------------- the document */

export function buildTransparencyDocument(
  data: TransparencyReportData,
  input: TransparencyReportInput
): ReportDocument {
  const t = copy[input.locale].revamp.reports;
  const tt = t.transparency;

  const monthRows: ReportRow[] = data.months.map((row) => ({
    month: row.month,
    published: row.published,
    resolved: row.resolved,
  }));

  const typeRows: ReportRow[] = data.byType.map((row) => ({
    type: row.name,
    count: row.count,
    resolvedShare: row.resolvedShare,
  }));

  const areaRows: ReportRow[] = data.byArea.map((row) => ({
    area: row.name,
    count: row.count,
    resolvedShare: row.resolvedShare,
  }));

  return {
    key: "transparency",
    title: tt.title,
    description: `${tt.description} ${t.lead.replace("{range}", reportRangeLabel(input.locale, input.period))}`,
    generatedAt: new Date().toISOString(),
    period: input.period,
    stats: [
      { label: tt.published, value: data.totals.published },
      { label: tt.resolved, value: data.totals.resolved },
      { label: tt.resolvedShare, value: `${data.totals.resolvedShare}%` },
      {
        label: tt.averageResponse,
        value:
          data.totals.averageResponseHours === null
            ? "—"
            : `${data.totals.averageResponseHours} ${copy[input.locale].revamp.reports.engineering.hoursSuffix}`,
        hint: String(data.totals.measured),
      },
    ],
    sections: [
      {
        key: "byMonth",
        title: tt.byMonth,
        columns: [
          textColumn("month", tt.monthCol),
          numericColumn("published", tt.publishedCol),
          numericColumn("resolved", tt.resolvedCol),
        ],
        rows: monthRows,
      },
      {
        key: "byType",
        title: tt.byType,
        columns: [
          textColumn("type", tt.typeCol),
          numericColumn("count", tt.countCol),
          numericColumn("resolvedShare", tt.resolvedShareCol),
        ],
        rows: typeRows,
      },
      {
        key: "byArea",
        title: tt.byArea,
        columns: [
          textColumn("area", tt.areaCol),
          numericColumn("count", tt.countCol),
          numericColumn("resolvedShare", tt.resolvedShareCol),
        ],
        rows: areaRows,
      },
    ],
  };
}

export async function loadTransparencyReport(
  input: TransparencyReportInput
): Promise<ReportDocument> {
  const data = await loadTransparencyData(input);
  return buildTransparencyDocument(data, input);
}
