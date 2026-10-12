import { db } from "@/lib/db";
import { copy, type Locale } from "@/lib/i18n";
import {
  numericColumn,
  textColumn,
  type ReportDocument,
  type ReportRow,
} from "@/lib/reports/document";
import { reportRangeLabel } from "@/lib/reports/labels";
import { inReportPeriod, type ReportPeriod } from "@/lib/reports/period";
import {
  AGING_BUCKETS,
  agingBucket,
  liquidationState,
  roundMoney,
  toMoney,
  type AgingBucket,
} from "@/lib/treasury/ledger";
import {
  listAllocations,
  listDisbursements,
  type AllocationRow,
  type DisbursementRow,
} from "@/lib/treasury/query";
import type { Actor } from "@/lib/treasury/budget";
import { formatPeso } from "@/lib/cases/manpower";

/**
 * Treasury reporting: MOOE utilisation, the disbursement register and how long
 * released money has been waiting for its liquidation.
 *
 * The scoping rules are not re-implemented here — `listAllocations` and
 * `listDisbursements` already apply the office scope for the acting user, and
 * the aging buckets are the same ones the treasury dashboard shows, so the
 * report and the screen can never disagree about what "over 90 days" means.
 */

export const REPORT_ROW_LIMIT = 5000;

export interface UtilisationTotals {
  appropriated: number;
  reserved: number;
  disbursed: number;
  available: number;
  allocations: number;
  utilisation: number | null;
}

export interface UtilisationRow {
  id: number;
  label: string;
  status: string;
  coaCode: string;
  coaName: string;
  appropriation: number;
  reserved: number;
  disbursed: number;
  available: number;
  utilisation: number | null;
}

/** Disbursed as a share of the appropriation, to one decimal. */
export function utilisationOf(
  appropriation: number,
  disbursed: number
): number | null {
  if (appropriation <= 0) return null;
  return Math.round((disbursed / appropriation) * 1000) / 10;
}

/** Closed allocations are historical: they are excluded, exactly as the dashboard does. */
export function summarizeUtilisation(
  allocations: readonly AllocationRow[]
): { totals: UtilisationTotals; rows: UtilisationRow[] } {
  const rows = allocations.map((allocation) => ({
    id: allocation.id,
    label: allocation.label,
    status: allocation.status,
    coaCode: allocation.coaCode,
    coaName: allocation.coaName,
    appropriation: allocation.appropriation,
    reserved: allocation.reserved,
    disbursed: allocation.disbursed,
    available: allocation.available,
    utilisation: utilisationOf(allocation.appropriation, allocation.disbursed),
  }));

  const active = rows.filter((row) => row.status !== "CLOSED");
  const totals = active.reduce<UtilisationTotals>(
    (acc, row) => ({
      appropriated: roundMoney(acc.appropriated + row.appropriation),
      reserved: roundMoney(acc.reserved + row.reserved),
      disbursed: roundMoney(acc.disbursed + row.disbursed),
      available: roundMoney(acc.available + row.available),
      allocations: acc.allocations + 1,
      utilisation: null,
    }),
    {
      appropriated: 0,
      reserved: 0,
      disbursed: 0,
      available: 0,
      allocations: 0,
      utilisation: null,
    }
  );
  totals.utilisation = utilisationOf(totals.appropriated, totals.disbursed);

  return {
    totals,
    rows: rows.sort(
      (a, b) => b.appropriation - a.appropriation || a.label.localeCompare(b.label)
    ),
  };
}

export interface LiquidationAgingRow {
  bucket: AgingBucket;
  count: number;
  amount: number;
}

/**
 * Aging of money that has left the barangay but has not been liquidated yet.
 * The clock starts at release (falling back to the day the voucher was
 * prepared, for rows migrated from before the treasury module existed).
 */
export function liquidationAging(
  vouchers: readonly DisbursementRow[],
  now: Date = new Date()
): LiquidationAgingRow[] {
  const totals = new Map<AgingBucket, { count: number; amount: number }>(
    AGING_BUCKETS.map((bucket) => [bucket, { count: 0, amount: 0 }])
  );

  for (const voucher of vouchers) {
    const state = liquidationState(voucher, now);
    if (voucher.status !== "RELEASED" && voucher.status !== "LIQUIDATED") continue;
    if (voucher.status === "LIQUIDATED" || state === "LIQUIDATED") continue;
    const since = voucher.releasedAt ?? voucher.preparedAt;
    const entry = totals.get(agingBucket(since, now))!;
    entry.count += 1;
    entry.amount = roundMoney(entry.amount + voucher.amount);
  }

  return AGING_BUCKETS.map((bucket) => ({
    bucket,
    count: totals.get(bucket)!.count,
    amount: totals.get(bucket)!.amount,
  }));
}

export interface RegisterSummary {
  rows: DisbursementRow[];
  total: number;
  byStatus: { status: string; count: number; amount: number }[];
  awaitingLiquidation: { count: number; amount: number };
}

/** Vouchers on the register, dated by when they were prepared. */
export function summarizeRegister(
  vouchers: readonly DisbursementRow[],
  period: ReportPeriod,
  now: Date = new Date()
): RegisterSummary {
  const rows = vouchers.filter((voucher) =>
    inReportPeriod(voucher.preparedAt, period)
  );

  const statusMap = new Map<string, { count: number; amount: number }>();
  for (const voucher of rows) {
    const entry = statusMap.get(voucher.status) ?? { count: 0, amount: 0 };
    entry.count += 1;
    entry.amount = roundMoney(entry.amount + voucher.amount);
    statusMap.set(voucher.status, entry);
  }

  const awaiting = rows.filter(
    (voucher) =>
      voucher.status !== "LIQUIDATED" && liquidationState(voucher, now) !== "LIQUIDATED"
  );

  return {
    rows,
    total: roundMoney(rows.reduce((sum, voucher) => sum + voucher.amount, 0)),
    byStatus: [...statusMap.entries()]
      .map(([status, value]) => ({ status, ...value }))
      .sort((a, b) => b.amount - a.amount),
    awaitingLiquidation: {
      count: awaiting.length,
      amount: roundMoney(awaiting.reduce((sum, voucher) => sum + voucher.amount, 0)),
    },
  };
}

/* ---------------------------------------------------------------- loaders */

export interface TreasuryReportInput {
  locale: Locale;
  period: ReportPeriod;
  actor: Actor;
  now?: Date;
}

export interface TreasuryReportData {
  utilisation: ReturnType<typeof summarizeUtilisation>;
  register: RegisterSummary;
  aging: LiquidationAgingRow[];
  allVouchers: DisbursementRow[];
}

export async function loadTreasuryData(
  input: TreasuryReportInput
): Promise<TreasuryReportData> {
  const now = input.now ?? new Date();
  const [allocations, vouchers] = await Promise.all([
    listAllocations(db, { actor: input.actor, take: REPORT_ROW_LIMIT }),
    listDisbursements(db, { actor: input.actor, take: REPORT_ROW_LIMIT }),
  ]);

  return {
    utilisation: summarizeUtilisation(allocations),
    register: summarizeRegister(vouchers, input.period, now),
    aging: liquidationAging(vouchers, now),
    allVouchers: vouchers,
  };
}

/* ------------------------------------------------------------- the document */

export function buildTreasuryDocument(
  data: TreasuryReportData,
  input: TreasuryReportInput
): ReportDocument {
  const t = copy[input.locale].revamp.reports;
  const tt = t.treasury;
  const peso = (value: number) => formatPeso(value);
  const pct = (value: number | null) => (value === null ? "—" : `${value}%`);

  const utilisationRows: ReportRow[] = data.utilisation.rows.map((row) => ({
    allocation: row.label,
    code: row.coaCode,
    appropriation: row.appropriation,
    reserved: row.reserved,
    disbursed: row.disbursed,
    available: row.available,
    utilisation: pct(row.utilisation),
  }));

  const registerRows: ReportRow[] = data.register.rows.map((row) => ({
    voucher: row.voucherNumber ?? `#${row.id}`,
    date: row.preparedAt.toISOString().slice(0, 10),
    payee: row.payee,
    particulars: row.particulars,
    status: row.statusLabel,
    amount: row.amount,
  }));

  const agingRows: ReportRow[] = data.aging.map((row) => ({
    bucket: bucketLabel(t.treasury, row.bucket),
    vouchers: row.count,
    amount: row.amount,
  }));

  const coaMap = new Map<
    string,
    { code: string; name: string; appropriation: number; disbursed: number; available: number }
  >();
  for (const row of data.utilisation.rows) {
    if (row.status === "CLOSED") continue;
    const entry = coaMap.get(row.coaCode) ?? {
      code: row.coaCode,
      name: row.coaName,
      appropriation: 0,
      disbursed: 0,
      available: 0,
    };
    entry.appropriation = roundMoney(entry.appropriation + row.appropriation);
    entry.disbursed = roundMoney(entry.disbursed + row.disbursed);
    entry.available = roundMoney(entry.available + row.available);
    coaMap.set(row.coaCode, entry);
  }
  const coaRows: ReportRow[] = [...coaMap.values()]
    .map((row) => ({
      code: row.code,
      account: row.name,
      appropriation: row.appropriation,
      disbursed: row.disbursed,
      available: row.available,
    }))
    .sort((a, b) => b.disbursed - a.disbursed);

  const totals = data.utilisation.totals;

  return {
    key: "treasury",
    title: tt.title,
    description: `${tt.description} ${t.lead.replace("{range}", reportRangeLabel(input.locale, input.period))}`,
    generatedAt: (input.now ?? new Date()).toISOString(),
    period: input.period,
    stats: [
      { label: tt.appropriation, value: peso(totals.appropriated) },
      { label: tt.disbursed, value: peso(totals.disbursed) },
      { label: tt.reserved, value: peso(totals.reserved) },
      { label: tt.available, value: peso(totals.available) },
      { label: tt.utilisation, value: pct(totals.utilisation) },
      {
        label: tt.awaitingLiquidation,
        value: peso(data.register.awaitingLiquidation.amount),
        hint: String(data.register.awaitingLiquidation.count),
        // Money released more than ninety days ago and still not liquidated is
        // the one figure in this report that is a finding wherever it appears.
        tone:
          (data.aging.find((row) => row.bucket === "90+")?.count ?? 0) > 0
            ? "danger"
            : "default",
      },
    ],
    sections: [
      {
        key: "utilisation",
        title: tt.allocations,
        columns: [
          textColumn("allocation", tt.allocationCol),
          textColumn("code", tt.codeCol),
          numericColumn("appropriation", tt.appropriationCol),
          numericColumn("reserved", tt.reservedCol),
          numericColumn("disbursed", tt.disbursedCol),
          numericColumn("available", tt.availableCol),
          numericColumn("utilisation", tt.utilisationCol),
        ],
        rows: utilisationRows,
        bars: utilisationRows.map((row) => ({
          key: "appropriation",
          share: Number(String(row.utilisation).replace("%", "")) || 0,
        })),
      },
      {
        key: "register",
        title: tt.register,
        columns: [
          textColumn("voucher", tt.voucherCol),
          textColumn("date", tt.dateCol),
          textColumn("payee", tt.payeeCol),
          textColumn("particulars", tt.particularsCol),
          textColumn("status", tt.statusCol),
          numericColumn("amount", tt.amountCol),
        ],
        rows: registerRows,
      },
      {
        key: "aging",
        title: tt.aging,
        columns: [
          textColumn("bucket", tt.bucketCol),
          numericColumn("vouchers", tt.vouchersCol),
          numericColumn("amount", tt.amountCol),
        ],
        rows: agingRows,
      },
      {
        key: "byCoa",
        title: tt.byCoa,
        columns: [
          textColumn("code", tt.codeCol),
          textColumn("account", tt.accountCol),
          numericColumn("appropriation", tt.appropriationCol),
          numericColumn("disbursed", tt.disbursedCol),
          numericColumn("available", tt.availableCol),
        ],
        rows: coaRows,
      },
    ],
  };
}

function bucketLabel(
  copy_: (typeof copy)["en"]["revamp"]["reports"]["treasury"],
  bucket: AgingBucket
): string {
  switch (bucket) {
    case "0-7":
      return copy_.bucket0_7;
    case "8-30":
      return copy_.bucket8_30;
    case "31-60":
      return copy_.bucket31_60;
    case "61-90":
      return copy_.bucket61_90;
    default:
      return copy_.bucket90_plus;
  }
}

export async function loadTreasuryReport(
  input: TreasuryReportInput
): Promise<ReportDocument> {
  const data = await loadTreasuryData(input);
  return buildTreasuryDocument(data, input);
}

export { toMoney };
