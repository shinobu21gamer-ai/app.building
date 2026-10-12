import { HOURS_PER_WORK_DAY } from "@/lib/cases/manpower";
import { windowsOverlap } from "@/lib/cases/crew-rules";
import {
  average,
  isResolvedStatus,
  resolveHours,
  closeHours,
  statusTallies,
  summarizeDurations,
} from "@/lib/cases/figures";
import { db } from "@/lib/db";
import type { Locale } from "@/lib/i18n";
import {
  count,
  decimal,
  monthLabel,
  numericColumn,
  percent,
  sharePercent,
  textColumn,
  type ReportDocument,
  type ReportSection,
} from "@/lib/reports/document";
import { reportLabels, reportRangeLabel, statusText } from "@/lib/reports/labels";
import {
  monthKeysForPeriod,
  periodRange,
  type ReportPeriod,
} from "@/lib/reports/period";

/**
 * The engineering report: how much work came in, how long it took, whether the
 * 48-hour clock was met, and how loaded the crews are.
 *
 * Everything below `loadEngineeringReport` is pure, and the loader only fetches:
 * the arithmetic that a barangay makes decisions from is unit-tested against
 * fixtures rather than against a live database.
 */

const MS_PER_HOUR = 3_600_000;

/** How many rows a report will read. A summary is not an export. */
export const REPORT_ROW_LIMIT = 5000;

export type EngineeringCaseRow = {
  id: number;
  caseNumber: string;
  status: string;
  priorityLevel: string | null;
  typeKey: string | null;
  typeName: string | null;
  categoryName: string;
  areaLabel: string | null;
  submittedAt: Date;
  resolvedAt: Date | null;
  closedAt: Date | null;
  slaDueAt: Date | null;
  slaBreachedAt: Date | null;
  workersNeeded: number | null;
  estimatedHours: number | null;
};

export type EscalationRow = {
  level: number;
  acknowledgedAt: Date | null;
  resolvedAt: Date | null;
};

export type CrewAssignmentRow = {
  crewId: number;
  crewName: string;
  trade: string | null;
  concernId: number;
  isActive: boolean;
  scheduledStartAt: Date | null;
  scheduledEndAt: Date | null;
  plannedHours: number | null;
};

/* ------------------------------------------------------------------ volume */

export type VolumeRow = {
  status: string;
  count: number;
  share: number;
};

export type TypeRow = {
  key: string;
  name: string;
  count: number;
  resolved: number;
  resolvedShare: number;
};

export type AreaRow = {
  area: string;
  count: number;
  open: number;
};

export type MonthRow = {
  month: string;
  submitted: number;
  resolved: number;
};

export type VolumeSummary = {
  total: number;
  open: number;
  byStatus: VolumeRow[];
  byType: TypeRow[];
  byArea: AreaRow[];
  byMonth: MonthRow[];
};

export function summarizeVolume(
  rows: readonly EngineeringCaseRow[],
  months: readonly string[]
): VolumeSummary {
  const total = rows.length;
  const open = rows.filter((row) => !isResolvedStatus(row.status)).length;

  const statusCounts = new Map<string, number>();
  for (const row of rows) {
    statusCounts.set(row.status, (statusCounts.get(row.status) ?? 0) + 1);
  }
  const byStatus = statusTallies(statusCounts).map((entry) => ({
    ...entry,
    share: sharePercent(entry.count, total) ?? 0,
  }));

  const typeMap = new Map<string, TypeRow>();
  for (const row of rows) {
    const key = row.typeKey ?? "UNCLASSIFIED";
    const existing = typeMap.get(key) ?? {
      key,
      name: row.typeName ?? row.categoryName,
      count: 0,
      resolved: 0,
      resolvedShare: 0,
    };
    existing.count += 1;
    if (isResolvedStatus(row.status)) existing.resolved += 1;
    typeMap.set(key, existing);
  }
  const byType = [...typeMap.values()]
    .map((row) => ({
      ...row,
      resolvedShare: sharePercent(row.resolved, row.count) ?? 0,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const areaMap = new Map<string, AreaRow>();
  for (const row of rows) {
    const area = row.areaLabel?.trim() || "—";
    const existing = areaMap.get(area) ?? { area, count: 0, open: 0 };
    existing.count += 1;
    if (!isResolvedStatus(row.status)) existing.open += 1;
    areaMap.set(area, existing);
  }
  const byArea = [...areaMap.values()].sort(
    (a, b) => b.count - a.count || a.area.localeCompare(b.area)
  );

  const byMonth = months.map((month) => ({
    month,
    submitted: rows.filter((row) => monthKeyOfManila(row.submittedAt) === month).length,
    resolved: rows.filter(
      (row) => row.resolvedAt !== null && monthKeyOfManila(row.resolvedAt) === month
    ).length,
  }));

  return { total, open, byStatus, byType, byArea, byMonth };
}

function monthKeyOfManila(value: Date): string {
  const shifted = new Date(value.getTime() + 8 * 60 * 60 * 1000);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

/* -------------------------------------------------------------- turnaround */

export type TurnaroundSummary = {
  resolvedSample: number;
  averageHours: number | null;
  medianHours: number | null;
  p90Hours: number | null;
  closedSample: number;
  averageCloseHours: number | null;
};

export function summarizeTurnaround(
  rows: readonly EngineeringCaseRow[]
): TurnaroundSummary {
  const resolved = summarizeDurations(resolveHours(rows));
  const closureHours = closeHours(rows);

  return {
    resolvedSample: resolved.sampleSize,
    averageHours: resolved.averageHours,
    medianHours: resolved.medianHours,
    p90Hours: resolved.p90Hours,
    closedSample: closureHours.length,
    averageCloseHours: average(closureHours),
  };
}

/* --------------------------------------------------------------------- SLA */

export type SlaSummary = {
  openCases: number;
  overdueNow: number;
  averageOverdueHours: number | null;
  resolvedMeasured: number;
  withinSla: number;
  complianceRate: number | null;
  breached: number;
  escalations: { level: number; count: number; open: number }[];
  escalationsOpen: number;
};

/**
 * Compliance and "overdue" are deliberately measured over different sets:
 * compliance over the cases resolved in this period, whichever day they were
 * submitted; overdue over every open case, however old — an unresolved case
 * from last year is late today whatever window you are reporting.
 */
export function summarizeSla(
  rows: readonly EngineeringCaseRow[],
  escalations: readonly EscalationRow[],
  now: Date
): SlaSummary {
  const open = rows.filter((row) => !isResolvedStatus(row.status));
  const overdue = open.filter(
    (row) => row.slaDueAt !== null && row.slaDueAt.getTime() < now.getTime()
  );

  const resolvedWithClock = rows.filter(
    (row) => row.resolvedAt !== null && row.slaDueAt !== null
  );
  const withinSla = resolvedWithClock.filter(
    (row) => row.resolvedAt!.getTime() <= row.slaDueAt!.getTime()
  );

  const overdueHours = overdue.map(
    (row) => (now.getTime() - (row.slaDueAt?.getTime() ?? now.getTime())) / MS_PER_HOUR
  );

  const levels = new Map<number, { level: number; count: number; open: number }>();
  for (const escalation of escalations) {
    const entry = levels.get(escalation.level) ?? {
      level: escalation.level,
      count: 0,
      open: 0,
    };
    entry.count += 1;
    // "Open" matches the SLA desk: an escalation is open until it is resolved,
    // even after somebody has acknowledged it.
    if (escalation.resolvedAt === null) entry.open += 1;
    levels.set(escalation.level, entry);
  }

  const compliance =
    resolvedWithClock.length === 0
      ? null
      : (withinSla.length / resolvedWithClock.length) * 100;

  return {
    openCases: open.length,
    overdueNow: overdue.length,
    averageOverdueHours: average(overdueHours),
    resolvedMeasured: resolvedWithClock.length,
    withinSla: withinSla.length,
    complianceRate: compliance,
    breached: resolvedWithClock.length - withinSla.length + overdue.length,
    escalations: [...levels.values()].sort((a, b) => a.level - b.level),
    escalationsOpen: escalations.filter((row) => row.resolvedAt === null).length,
  };
}

/* -------------------------------------------------------------------- crew */

export type CrewRow = {
  crewId: number;
  name: string;
  trade: string | null;
  activeJobs: number;
  assignments: number;
  plannedHours: number | null;
  utilisation: number | null;
  overlaps: number;
};

export type CrewSummary = {
  members: CrewRow[];
  totalPlannedHours: number;
  overlaps: number;
};

/** Working days in a window: five of every seven calendar days. */
export function workingDaysIn(days: number | null): number {
  const span = days ?? 90;
  return Math.max(1, Math.round((span * 5) / 7));
}

export function summarizeCrew(
  rows: readonly CrewAssignmentRow[],
  periodDays: number | null
): CrewSummary {
  const members = new Map<number, { name: string; trade: string | null; windows: CrewAssignmentRow[] }>();
  for (const row of rows) {
    const entry = members.get(row.crewId) ?? {
      name: row.crewName,
      trade: row.trade,
      windows: [],
    };
    entry.windows.push(row);
    members.set(row.crewId, entry);
  }

  const capacityHours = Math.max(1, workingDaysIn(periodDays)) * HOURS_PER_WORK_DAY;

  const crew: CrewRow[] = [...members.entries()]
    .map(([crewId, entry]) => {
      const plannedHours = entry.windows.reduce(
        (sum, row) => sum + (row.plannedHours ?? 0),
        0
      );
      const scheduled = entry.windows.filter(
        (row) => row.scheduledStartAt !== null && row.scheduledEndAt !== null
      );
      let overlaps = 0;
      for (let i = 0; i < scheduled.length; i += 1) {
        for (let j = i + 1; j < scheduled.length; j += 1) {
          if (
            windowsOverlap(
              { startAt: scheduled[i].scheduledStartAt, endAt: scheduled[i].scheduledEndAt },
              { startAt: scheduled[j].scheduledStartAt, endAt: scheduled[j].scheduledEndAt }
            )
          ) {
            overlaps += 1;
          }
        }
      }

      const hasAnyPlan = entry.windows.some((row) => row.plannedHours !== null);

      return {
        crewId,
        name: entry.name,
        trade: entry.trade,
        activeJobs: entry.windows.filter((row) => row.isActive).length,
        assignments: entry.windows.length,
        plannedHours: hasAnyPlan ? plannedHours : null,
        utilisation: hasAnyPlan ? (plannedHours / capacityHours) * 100 : null,
        overlaps,
      };
    })
    .sort((a, b) => b.activeJobs - a.activeJobs || a.name.localeCompare(b.name));

  return {
    members: crew,
    totalPlannedHours: crew.reduce((sum, row) => sum + (row.plannedHours ?? 0), 0),
    overlaps: crew.reduce((sum, row) => sum + row.overlaps, 0),
  };
}

/* ------------------------------------------------------------------ loader */

export type EngineeringReportInput = {
  locale: Locale;
  period: ReportPeriod;
  /** An office id narrows every figure to that office; null is barangay-wide. */
  officeId?: number | null;
  now?: Date;
};

export async function loadEngineeringReport(
  input: EngineeringReportInput
): Promise<ReportDocument> {
  const now = input.now ?? new Date();
  const t = reportLabels(input.locale);
  const range = periodRange(input.period);
  const scope = input.officeId ? { assignedOfficeId: input.officeId } : {};

  const concerns = await db.concern.findMany({
    where: {
      ...scope,
      ...(range ? { submittedAt: range } : {}),
    },
    select: {
      id: true,
      caseNumber: true,
      status: true,
      priorityLevel: true,
      submittedAt: true,
      resolvedAt: true,
      closedAt: true,
      slaDueAt: true,
      slaBreachedAt: true,
      locationPurok: true,
      type: { select: { key: true, name: true } },
      category: { select: { name: true } },
      caseAssessment: {
        select: { workersNeeded: true, estimatedDurationMinutes: true },
      },
    },
    orderBy: { submittedAt: "desc" },
    take: REPORT_ROW_LIMIT,
  });

  // "Overdue right now" is a statement about today, not about the period, so
  // open cases are read separately rather than filtered out by the window.
  const openCases = await db.concern.findMany({
    where: { ...scope, status: { notIn: ["RESOLVED", "CLOSED"] } },
    select: {
      id: true,
      caseNumber: true,
      status: true,
      priorityLevel: true,
      submittedAt: true,
      resolvedAt: true,
      closedAt: true,
      slaDueAt: true,
      slaBreachedAt: true,
      locationPurok: true,
      type: { select: { key: true, name: true } },
      category: { select: { name: true } },
      caseAssessment: {
        select: { workersNeeded: true, estimatedDurationMinutes: true },
      },
    },
    take: REPORT_ROW_LIMIT,
  });

  const rows: EngineeringCaseRow[] = concerns.map((row) => ({
    id: row.id,
    caseNumber: row.caseNumber,
    status: row.status,
    priorityLevel: row.priorityLevel,
    typeKey: row.type?.key ?? null,
    typeName: row.type?.name ?? null,
    categoryName: row.category.name,
    areaLabel: row.locationPurok,
    submittedAt: row.submittedAt,
    resolvedAt: row.resolvedAt,
    closedAt: row.closedAt,
    slaDueAt: row.slaDueAt,
    slaBreachedAt: row.slaBreachedAt,
    workersNeeded: row.caseAssessment?.workersNeeded ?? null,
    estimatedHours:
      row.caseAssessment?.estimatedDurationMinutes === null ||
      row.caseAssessment?.estimatedDurationMinutes === undefined
        ? null
        : row.caseAssessment.estimatedDurationMinutes / 60,
  }));

  const openRows: EngineeringCaseRow[] = openCases.map((row) => ({
    id: row.id,
    caseNumber: row.caseNumber,
    status: row.status,
    priorityLevel: row.priorityLevel,
    typeKey: row.type?.key ?? null,
    typeName: row.type?.name ?? null,
    categoryName: row.category.name,
    areaLabel: row.locationPurok,
    submittedAt: row.submittedAt,
    resolvedAt: row.resolvedAt,
    closedAt: row.closedAt,
    slaDueAt: row.slaDueAt,
    slaBreachedAt: row.slaBreachedAt,
    workersNeeded: row.caseAssessment?.workersNeeded ?? null,
    estimatedHours:
      row.caseAssessment?.estimatedDurationMinutes === null ||
      row.caseAssessment?.estimatedDurationMinutes === undefined
        ? null
        : row.caseAssessment.estimatedDurationMinutes / 60,
  }));

  const inPeriodIds = rows.map((row) => row.id);
  const escalations = await db.caseEscalation.findMany({
    where: {
      ...(inPeriodIds.length > 0 ? { concernId: { in: inPeriodIds } } : { concernId: -1 }),
      ...(range ? { createdAt: range } : {}),
    },
    select: { level: true, acknowledgedAt: true, resolvedAt: true, createdAt: true },
    take: REPORT_ROW_LIMIT,
  });

  const assignments = await db.crewAssignment.findMany({
    where: {
      ...(range ? { assignedAt: range } : {}),
      ...(input.officeId ? { concern: { assignedOfficeId: input.officeId } } : {}),
    },
    select: {
      crewId: true,
      concernId: true,
      isActive: true,
      scheduledStartAt: true,
      scheduledEndAt: true,
      crew: { select: { firstName: true, lastName: true } },
      concern: {
        select: {
          caseAssessment: { select: { estimatedDurationMinutes: true } },
        },
      },
    },
    take: REPORT_ROW_LIMIT,
  });

  const assessmentHours = new Map<number, number>();
  for (const row of rows) {
    if (row.estimatedHours !== null) assessmentHours.set(row.id, row.estimatedHours);
  }

  const crewRows: CrewAssignmentRow[] = assignments.map((row) => {
    // Prefer the assignment's own case assessments; fall back to the period's
    // cases when the assignment points at a case outside the window.
    const hours =
      row.concern?.caseAssessment?.estimatedDurationMinutes === null ||
      row.concern?.caseAssessment?.estimatedDurationMinutes === undefined
        ? (assessmentHours.get(row.concernId) ?? null)
        : row.concern.caseAssessment.estimatedDurationMinutes / 60;
    return {
      crewId: row.crewId,
      crewName: `${row.crew.firstName} ${row.crew.lastName}`.trim(),
      trade: null,
      concernId: row.concernId,
      isActive: row.isActive,
      scheduledStartAt: row.scheduledStartAt,
      scheduledEndAt: row.scheduledEndAt,
      plannedHours: hours,
    };
  });

  const volume = summarizeVolume(rows, monthKeysForPeriod(input.period));
  const turnaround = summarizeTurnaround(rows);
  // An open case inside the window is in both lists, and "Open now" / "Overdue
  // vs SLA" are statements about cases, not about rows: dedupe by id so a case
  // that was submitted this period and is still open is counted once.
  const slaRows = new Map<number, EngineeringCaseRow>();
  for (const row of [...rows, ...openRows]) slaRows.set(row.id, row);
  const sla = summarizeSla([...slaRows.values()], escalations, now);
  const crew = summarizeCrew(crewRows, input.period.days);

  const statusSection: ReportSection = {
    key: "volumeByStatus",
    title: t.engineering.byStatus,
    columns: [
      textColumn("status", t.engineering.statusCol),
      numericColumn("cases", t.engineering.countCol),
      numericColumn("share", t.engineering.shareCol),
    ],
    rows: volume.byStatus.map((row) => ({
      status: statusText(input.locale, row.status),
      cases: row.count,
      share: percent(row.share),
    })),
    // The bar sits under the first column and is sized by the row's share.
    bars: volume.byStatus.map((row) => ({ key: "cases", share: row.share })),
  };

  const typeSection: ReportSection = {
    key: "volumeByType",
    title: t.engineering.byType,
    columns: [
      textColumn("type", t.engineering.typeCol),
      numericColumn("cases", t.engineering.countCol),
      numericColumn("resolved", t.engineering.resolvedCol),
      numericColumn("resolvedShare", t.engineering.resolvedShareCol),
    ],
    rows: volume.byType.map((row) => ({
      type: row.name,
      cases: row.count,
      resolved: row.resolved,
      resolvedShare: percent(row.resolvedShare),
    })),
  };

  const areaSection: ReportSection = {
    key: "volumeByArea",
    title: t.engineering.byArea,
    columns: [
      textColumn("area", t.engineering.areaCol),
      numericColumn("cases", t.engineering.countCol),
      numericColumn("open", t.engineering.openCol),
    ],
    rows: volume.byArea.map((row) => ({
      area: row.area,
      cases: row.count,
      open: row.open,
    })),
  };

  const monthSection: ReportSection = {
    key: "volumeByMonth",
    title: t.engineering.byMonth,
    columns: [
      textColumn("month", t.engineering.monthCol),
      numericColumn("submitted", t.engineering.submittedCol),
      numericColumn("resolved", t.engineering.resolvedCol),
    ],
    rows: volume.byMonth.map((row) => ({
      month: monthLabel(row.month),
      submitted: row.submitted,
      resolved: row.resolved,
    })),
  };

  const turnaroundSection: ReportSection = {
    key: "turnaround",
    title: t.engineering.turnaround,
    columns: [
      textColumn("metric", t.engineering.metricCol),
      numericColumn("value", t.engineering.valueCol),
    ],
    rows: [
      { metric: t.engineering.averageHours, value: hoursCell(turnaround.averageHours, t.engineering.hoursSuffix) },
      { metric: t.engineering.medianHours, value: hoursCell(turnaround.medianHours, t.engineering.hoursSuffix) },
      { metric: t.engineering.p90Hours, value: hoursCell(turnaround.p90Hours, t.engineering.hoursSuffix) },
      { metric: t.engineering.averageClose, value: hoursCell(turnaround.averageCloseHours, t.engineering.hoursSuffix) },
      { metric: t.engineering.sample, value: count(turnaround.resolvedSample) },
    ],
  };

  const slaSection: ReportSection = {
    key: "sla",
    title: t.engineering.sla,
    description: t.engineering.slaNote,
    columns: [
      textColumn("metric", t.engineering.metricCol),
      numericColumn("value", t.engineering.valueCol),
    ],
    rows: [
      { metric: t.engineering.compliance, value: percent(sla.complianceRate) },
      { metric: t.engineering.withinSla, value: count(sla.withinSla) },
      { metric: t.engineering.overdueNow, value: count(sla.overdueNow) },
      {
        metric: t.engineering.averageOverdue,
        value: hoursCell(sla.averageOverdueHours, t.engineering.hoursSuffix),
      },
      { metric: t.engineering.breached, value: count(sla.breached) },
      { metric: t.engineering.escalations, value: count(sla.escalations.reduce((sum, row) => sum + row.count, 0)) },
      { metric: t.engineering.escalationsOpen, value: count(sla.escalationsOpen) },
    ],
  };

  const crewSection: ReportSection = {
    key: "crew",
    title: t.engineering.crew,
    description: t.engineering.crewNote,
    columns: [
      textColumn("crew", t.engineering.crewCol),
      numericColumn("active", t.engineering.activeCol),
      numericColumn("assignments", t.engineering.assignmentsCol),
      numericColumn("estimatedHours", t.engineering.estimatedHoursCol),
      numericColumn("utilisation", t.engineering.loadCol),
      numericColumn("overlaps", t.engineering.conflictsCol),
    ],
    rows: crew.members.map((row) => ({
      crew: row.name,
      active: row.activeJobs,
      assignments: row.assignments,
      estimatedHours: decimal(row.plannedHours),
      utilisation: percent(row.utilisation),
      overlaps: row.overlaps,
    })),
  };

  const resolvedInPeriod = rows.filter((row) => isResolvedStatus(row.status)).length;
  const overdueInPeriod = rows.filter(
    (row) =>
      !isResolvedStatus(row.status) &&
      row.slaDueAt !== null &&
      row.slaDueAt.getTime() < now.getTime()
  ).length;

  return {
    key: "engineering",
    title: t.engineering.title,
    description: `${t.engineering.description} ${t.lead.replace(
      "{range}",
      reportRangeLabel(input.locale, input.period)
    )}`,
    generatedAt: now.toISOString(),
    period: input.period,
    stats: [
      { label: t.engineering.cases, value: count(volume.total) },
      { label: t.engineering.openNow, value: count(sla.openCases) },
      {
        label: t.engineering.overdue,
        value: count(sla.overdueNow),
        hint: t.engineering.overdueNow,
        // Any overdue case is the point of the number, so it is coloured.
        tone: sla.overdueNow > 0 ? "danger" : "default",
      },
      { label: t.engineering.resolvedInPeriod, value: count(resolvedInPeriod) },
      {
        label: t.engineering.median,
        value: hoursCell(turnaround.medianHours, t.engineering.hoursSuffix),
        hint: `${count(turnaround.resolvedSample).toString()} ${t.engineering.sample.toLowerCase()}`,
      },
      {
        label: t.engineering.compliance,
        value: percent(sla.complianceRate),
        // The target is every case on time; below it is a warning, not a
        // failure — the number is already the share that met the clock.
        tone:
          sla.complianceRate === null
            ? "default"
            : sla.complianceRate >= 100
              ? "success"
              : "warning",
      },
      {
        label: t.engineering.crewHours,
        value: decimal(crew.totalPlannedHours),
        hint: `${overdueInPeriod.toString()} ${t.engineering.overdueNow.toLowerCase()}`,
      },
    ],
    sections: [
      statusSection,
      typeSection,
      areaSection,
      monthSection,
      turnaroundSection,
      slaSection,
      crewSection,
    ],
  };
}

/** Hours as a short cell: "36 h", or "—" when nothing has been measured. */
function hoursCell(value: number | null | undefined, suffix = "h"): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${(Math.round(value * 10) / 10).toString()} ${suffix}`;
}
