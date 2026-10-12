import { db } from "@/lib/db";
import { copy, type Locale } from "@/lib/i18n";
import {
  numericColumn,
  textColumn,
  type ReportDocument,
  type ReportRow,
  capRows,
  withRowLimitStat,
} from "@/lib/reports/document";
import { reportRangeLabel } from "@/lib/reports/labels";
import { inReportPeriod, periodRange, type ReportPeriod } from "@/lib/reports/period";
import {
  DSR_STATUSES,
  DSR_TYPE_LABELS,
  DSR_TYPES,
  type DsrType,
} from "@/lib/privacy/catalog";
import { dsrDeadlineState, workingDaysBetween } from "@/lib/privacy/dates";

/**
 * The barangay's own RA 10173 scorecard: what residents asked for, what they
 * consented to, which personal fields staff opened, and what the retention
 * sweep has been doing.
 *
 * This report deliberately shows **counts, not values**. It says twelve phone
 * numbers were revealed this quarter and by which purpose; it never repeats a
 * number, a name or a document. The audit trail is where individual reads are
 * examined, and that already has its own access control.
 */

export const REPORT_ROW_LIMIT = 5000;

export interface DsrRow {
  referenceCode: string;
  type: string;
  status: string;
  requestedAt: Date;
  dueAt: Date | null;
  resolvedAt: Date | null;
}

export interface ConsentRow {
  purpose: string;
  status: string;
  grantedAt: Date;
  withdrawnAt: Date | null;
}

export interface PiiAccessRow {
  field: string;
  purpose: string;
  createdAt: Date;
}

export interface RetentionPolicyRow {
  key: string;
  dataCategory: string;
  action: string;
  retentionDays: number;
  isActive: boolean;
  lastRunAt: Date | null;
}

export interface RetentionRunRow {
  policyKey: string | null;
  job: string;
  status: string;
  startedAt: Date;
  scanned: number;
  affected: number;
}

const OPEN_DSR: readonly string[] = DSR_STATUSES.filter(
  (status) => status !== "COMPLETED" && status !== "REJECTED"
);

export function isOpenDsr(status: string): boolean {
  return OPEN_DSR.includes(status);
}

/* -------------------------------------------------------------------- DSR */

export interface DsrSummary {
  received: number;
  open: number;
  overdue: number;
  /** Open requests whose deadline falls inside the warning window. */
  dueSoon: number;
  completed: number;
  averageHandlingDays: number | null;
  byType: { type: string; label: string; count: number; completed: number; overdue: number }[];
  byStatus: { status: string; count: number }[];
  queue: { referenceCode: string; type: string; status: string; dueAt: Date | null; workingDaysLate: number }[];
}

/**
 * The statutory clock is counted in working days (RA 10173 gives fifteen), so
 * lateness is measured in working days too — a request due on a Friday is not
 * late on the following Monday.
 */
export function summarizeDsr(
  rows: readonly DsrRow[],
  now: Date = new Date(),
  holidays: readonly string[] = []
): DsrSummary {
  const overdue = rows.filter(
    (row) =>
      isOpenDsr(row.status) &&
      row.dueAt !== null &&
      row.dueAt.getTime() < now.getTime()
  );

  // The same third-of-a-week margin the privacy desk badges, so the report and
  // the queue never disagree about which request is about to run out of time.
  const dueSoon = rows.filter(
    (row) =>
      isOpenDsr(row.status) &&
      dsrDeadlineState({ dueAt: row.dueAt, resolvedAt: row.resolvedAt, now }) === "due_soon"
  );

  const handled = rows.filter(
    (row) => row.resolvedAt !== null && isOpenDsr(row.status) === false
  );
  const handlingDays = handled
    .map((row) => workingDaysBetween(row.requestedAt, row.resolvedAt!, holidays))
    .filter((days) => days >= 0);

  const typeMap = new Map<
    string,
    { type: string; label: string; count: number; completed: number; overdue: number }
  >();
  for (const row of rows) {
    const entry = typeMap.get(row.type) ?? {
      type: row.type,
      label: DSR_TYPE_LABELS[row.type as DsrType] ?? row.type,
      count: 0,
      completed: 0,
      overdue: 0,
    };
    entry.count += 1;
    if (!isOpenDsr(row.status)) entry.completed += 1;
    if (overdue.includes(row)) entry.overdue += 1;
    typeMap.set(row.type, entry);
  }

  const statusMap = new Map<string, number>();
  for (const row of rows) {
    statusMap.set(row.status, (statusMap.get(row.status) ?? 0) + 1);
  }

  const knownTypes = new Set(DSR_TYPES as readonly string[]);
  const byType = [
    ...DSR_TYPES.map(
      (type) =>
        typeMap.get(type) ?? {
          type,
          label: DSR_TYPE_LABELS[type],
          count: 0,
          completed: 0,
          overdue: 0,
        }
    ),
    ...[...typeMap.values()].filter((row) => !knownTypes.has(row.type)),
  ];

  const averageDays =
    handlingDays.length === 0
      ? null
      : Math.round((handlingDays.reduce((sum, days) => sum + days, 0) / handlingDays.length) * 10) / 10;

  return {
    received: rows.length,
    open: rows.filter((row) => isOpenDsr(row.status)).length,
    overdue: overdue.length,
    dueSoon: dueSoon.length,
    completed: handled.length,
    averageHandlingDays: averageDays,
    byType,
    byStatus: DSR_STATUSES.map((status) => ({
      status,
      count: statusMap.get(status) ?? 0,
    })),
    queue: overdue
      .map((row) => ({
        referenceCode: row.referenceCode,
        type: row.type,
        status: row.status,
        dueAt: row.dueAt,
        workingDaysLate: workingDaysBetween(row.dueAt!, now, holidays),
      }))
      .sort((a, b) => b.workingDaysLate - a.workingDaysLate),
  };
}

/* --------------------------------------------------------------- consents */

export interface ConsentSummary {
  granted: number;
  withdrawn: number;
  /** Withdrawn as a share of the consents touched in the period. */
  withdrawalShare: number;
  byPurpose: { purpose: string; granted: number; withdrawn: number; grantedShare: number }[];
}

export function summarizeConsents(
  rows: readonly ConsentRow[]
): ConsentSummary {
  const map = new Map<string, { purpose: string; granted: number; withdrawn: number }>();
  for (const row of rows) {
    const entry = map.get(row.purpose) ?? { purpose: row.purpose, granted: 0, withdrawn: 0 };
    if (row.status === "WITHDRAWN" || row.withdrawnAt !== null) entry.withdrawn += 1;
    else entry.granted += 1;
    map.set(row.purpose, entry);
  }

  const byPurpose = [...map.values()]
    .map((entry) => {
      const total = entry.granted + entry.withdrawn;
      return {
        ...entry,
        grantedShare: total === 0 ? 0 : Math.round((entry.granted / total) * 1000) / 10,
      };
    })
    .sort((a, b) => b.granted + b.withdrawn - (a.granted + a.withdrawn));

  const granted = byPurpose.reduce((sum, row) => sum + row.granted, 0);
  const withdrawn = byPurpose.reduce((sum, row) => sum + row.withdrawn, 0);
  const total = granted + withdrawn;

  return {
    granted,
    withdrawn,
    withdrawalShare: total === 0 ? 0 : Math.round((withdrawn / total) * 1000) / 10,
    byPurpose,
  };
}

/* -------------------------------------------------------------- PII reads */

export interface AccessCounter {
  key: string;
  count: number;
}

export function countBy<T>(
  rows: readonly T[],
  pick: (row: T) => string
): AccessCounter[] {
  const map = new Map<string, number>();
  for (const row of rows) {
    const key = pick(row);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/* -------------------------------------------------------------- retention */

export interface RetentionSummaryRow {
  key: string;
  dataCategory: string;
  action: string;
  retentionDays: number;
  isActive: boolean;
  lastRunAt: Date | null;
  scanned: number;
  affected: number;
  status: string;
}

export function summarizeRetention(
  policies: readonly RetentionPolicyRow[],
  runs: readonly RetentionRunRow[]
): { rows: RetentionSummaryRow[]; affected: number; runs: number; failures: number } {
  const byPolicy = new Map<string, RetentionRunRow[]>();
  for (const run of runs) {
    if (!run.policyKey) continue;
    byPolicy.set(run.policyKey, [...(byPolicy.get(run.policyKey) ?? []), run]);
  }

  const rows = policies.map((policy) => {
    const policyRuns = (byPolicy.get(policy.key) ?? []).sort(
      (a, b) => b.startedAt.getTime() - a.startedAt.getTime()
    );
    const latest = policyRuns[0] ?? null;
    return {
      key: policy.key,
      dataCategory: policy.dataCategory,
      action: policy.action,
      retentionDays: policy.retentionDays,
      isActive: policy.isActive,
      lastRunAt: policy.lastRunAt ?? latest?.startedAt ?? null,
      scanned: policyRuns.reduce((sum, run) => sum + run.scanned, 0),
      affected: policyRuns.reduce((sum, run) => sum + run.affected, 0),
      status: latest?.status ?? "—",
    };
  });

  return {
    rows: rows.sort((a, b) => a.key.localeCompare(b.key)),
    affected: rows.reduce((sum, row) => sum + row.affected, 0),
    runs: runs.length,
    failures: runs.filter((run) => run.status === "FAILED").length,
  };
}

/* ----------------------------------------------------------------- loaders */

export interface PrivacyReportInput {
  locale: Locale;
  period: ReportPeriod;
  now?: Date;
}

export interface PrivacyReportData {
  dsr: DsrSummary;
  consents: ConsentSummary;
  piiByField: AccessCounter[];
  piiByPurpose: AccessCounter[];
  piiTotal: number;
  retention: ReturnType<typeof summarizeRetention>;
  /** True when at least one capped query had more rows than it was allowed to read. */
  truncated: boolean;
}

export async function loadPrivacyData(
  input: PrivacyReportInput
): Promise<PrivacyReportData> {
  const now = input.now ?? new Date();
  const range = periodRange(input.period);

  // Capped queries read one row past the limit so a cut-off is visible, and
  // each is ordered newest-first so the rows kept are the most recent ones.
  const [requestsRead, consentsRead, accessRead, policies, runsRead] = await Promise.all([
    db.dataSubjectRequest.findMany({
      where: range ? { requestedAt: range } : {},
      select: {
        referenceCode: true,
        type: true,
        status: true,
        requestedAt: true,
        dueAt: true,
        resolvedAt: true,
      },
      orderBy: { requestedAt: "desc" },
      take: REPORT_ROW_LIMIT + 1,
    }),
    db.consentRecord.findMany({
      where: range
        ? { OR: [{ grantedAt: range }, { withdrawnAt: range }] }
        : {},
      select: { purpose: true, status: true, grantedAt: true, withdrawnAt: true },
      orderBy: { grantedAt: "desc" },
      take: REPORT_ROW_LIMIT + 1,
    }),
    db.piiAccessLog.findMany({
      where: range ? { createdAt: range } : {},
      select: { field: true, purpose: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: REPORT_ROW_LIMIT + 1,
    }),
    db.retentionPolicy.findMany({
      select: {
        key: true,
        dataCategory: true,
        action: true,
        retentionDays: true,
        isActive: true,
        lastRunAt: true,
      },
      orderBy: { key: "asc" },
    }),
    db.retentionRun.findMany({
      where: range ? { startedAt: range } : {},
      select: {
        job: true,
        status: true,
        startedAt: true,
        scanned: true,
        affected: true,
        policy: { select: { key: true } },
      },
      orderBy: { startedAt: "desc" },
      take: REPORT_ROW_LIMIT + 1,
    }),
  ]);

  const requestsCap = capRows(requestsRead, REPORT_ROW_LIMIT);
  const consentsCap = capRows(consentsRead, REPORT_ROW_LIMIT);
  const accessCap = capRows(accessRead, REPORT_ROW_LIMIT);
  const runsCap = capRows(runsRead, REPORT_ROW_LIMIT);
  const truncated =
    requestsCap.truncated ||
    consentsCap.truncated ||
    accessCap.truncated ||
    runsCap.truncated;

  const accessRows: PiiAccessRow[] = accessCap.rows.filter((row) =>
    inReportPeriod(row.createdAt, input.period)
  );


  return {
    dsr: summarizeDsr(requestsCap.rows, now),
    consents: summarizeConsents(consentsCap.rows),
    piiByField: countBy(accessRows, (row) => row.field),
    piiByPurpose: countBy(accessRows, (row) => row.purpose),
    piiTotal: accessRows.length,
    truncated,
    retention: summarizeRetention(
      policies,
      runsCap.rows.map((run) => ({
        policyKey: run.policy?.key ?? null,
        job: run.job,
        status: run.status,
        startedAt: run.startedAt,
        scanned: run.scanned,
        affected: run.affected,
      }))
    ),
  };
}

/* ------------------------------------------------------------- the document */

export function buildPrivacyDocument(
  data: PrivacyReportData,
  input: PrivacyReportInput
): ReportDocument {
  const t = copy[input.locale].revamp.reports;
  const tp = t.privacy;
  const day = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : "—");

  const dsrTypeRows: ReportRow[] = data.dsr.byType.map((row) => ({
    type: row.label,
    count: row.count,
    completed: row.completed,
    overdue: row.overdue,
  }));

  const dsrQueueRows: ReportRow[] = data.dsr.queue.map((row) => ({
    reference: row.referenceCode,
    type: DSR_TYPE_LABELS[row.type as DsrType] ?? row.type,
    status: row.status,
    due: day(row.dueAt),
    late: row.workingDaysLate,
  }));

  const consentRows: ReportRow[] = data.consents.byPurpose.map((row) => ({
    purpose: row.purpose,
    granted: row.granted,
    withdrawn: row.withdrawn,
    share: row.grantedShare,
  }));

  const fieldRows: ReportRow[] = data.piiByField.map((row) => ({
    field: row.key,
    reads: row.count,
  }));

  const purposeRows: ReportRow[] = data.piiByPurpose.map((row) => ({
    purpose: row.key,
    reads: row.count,
  }));

  const retentionRows: ReportRow[] = data.retention.rows.map((row) => ({
    policy: row.key,
    category: row.dataCategory,
    action: row.action,
    retentionDays: row.retentionDays,
    lastRun: day(row.lastRunAt),
    scanned: row.scanned,
    affected: row.affected,
    status: row.status,
  }));

  const document: ReportDocument = {
    key: "privacy",
    title: tp.title,
    description: `${tp.description} ${t.lead.replace("{range}", reportRangeLabel(input.locale, input.period))}`,
    generatedAt: (input.now ?? new Date()).toISOString(),
    period: input.period,
    stats: [
      { label: tp.dsrReceived, value: data.dsr.received },
      { label: tp.dsrOpen, value: data.dsr.open },
      {
        label: tp.dsrOverdue,
        value: data.dsr.overdue,
        hint: `${data.dsr.dueSoon.toString()} ${tp.dueSoonNote}`,
        // Past the deadline is a finding; nothing past it but something inside
        // the warning window is the heads-up the desk badges show too.
        tone:
          data.dsr.overdue > 0
            ? "danger"
            : data.dsr.dueSoon > 0
              ? "warning"
              : "default",
      },
      { label: tp.consentsWithdrawn, value: data.consents.withdrawn },
      { label: tp.piiReads, value: data.piiTotal },
      { label: tp.retentionAffected, value: data.retention.affected },
    ],
    sections: [
      {
        key: "dsrByType",
        title: tp.dsrByType,
        columns: [
          textColumn("type", tp.typeCol),
          numericColumn("count", tp.requestedCol),
          numericColumn("completed", tp.completedCol),
          numericColumn("overdue", tp.overdueCol),
        ],
        rows: dsrTypeRows,
      },
      {
        key: "dsrQueue",
        title: tp.dsrQueue,
        columns: [
          textColumn("reference", tp.referenceCol),
          textColumn("type", tp.typeCol),
          textColumn("status", tp.statusCol),
          textColumn("due", tp.dueCol),
          numericColumn("late", tp.lateCol),
        ],
        rows: dsrQueueRows,
      },
      {
        key: "consents",
        title: tp.consents,
        columns: [
          textColumn("purpose", tp.purposeCol),
          numericColumn("granted", tp.grantedCol),
          numericColumn("withdrawn", tp.withdrawnCol),
          numericColumn("share", tp.grantedShareCol),
        ],
        rows: consentRows,
      },
      {
        key: "piiByField",
        title: tp.piiByField,
        columns: [textColumn("field", tp.fieldCol), numericColumn("reads", tp.readsCol)],
        rows: fieldRows,
      },
      {
        key: "piiByPurpose",
        title: tp.piiByPurpose,
        columns: [textColumn("purpose", tp.purposeCol), numericColumn("reads", tp.readsCol)],
        rows: purposeRows,
      },
      {
        key: "retention",
        title: tp.retention,
        columns: [
          textColumn("policy", tp.policyCol),
          textColumn("category", tp.categoryCol),
          textColumn("action", tp.actionCol),
          numericColumn("retentionDays", tp.retentionDaysCol),
          textColumn("lastRun", tp.lastRunCol),
          numericColumn("scanned", tp.scannedCol),
          numericColumn("affected", tp.affectedCol),
          textColumn("status", tp.runStatusCol),
        ],
        rows: retentionRows,
      },
    ],
  };
  return withRowLimitStat(document, data.truncated, t, REPORT_ROW_LIMIT);
}

export async function loadPrivacyReport(
  input: PrivacyReportInput
): Promise<ReportDocument> {
  const data = await loadPrivacyData(input);
  return buildPrivacyDocument(data, input);
}
