import {
  CASE_STATUSES,
  PRIORITY_LEVELS,
  type CaseStatus,
  type PriorityLevel,
} from "@/lib/cases/workflow";

/**
 * The case figures, in one place.
 *
 * "How long does a case take here?" and "what is this office carrying?" are
 * asked on the dashboards, in the admin concern report and in the report
 * library. The arithmetic lives here once and each surface brings only its own
 * query, so the same question cannot get two different answers depending on
 * which screen is open.
 *
 * Pure — no database: the queries stay in `dashboards/` and `reports/`.
 */

/** Resolved and closed are both finished; everything else is still open. */
export function isResolvedStatus(status: string): boolean {
  return status === "RESOLVED" || status === "CLOSED";
}

/** What the desks call pending: submitted, not yet being worked on. */
export const PENDING_STATUSES: readonly CaseStatus[] = ["SUBMITTED", "ASSIGNED"];

/** What the desks call high priority. */
export const HIGH_PRIORITY_LEVELS: readonly PriorityLevel[] = [
  "HIGH",
  "CRITICAL",
];

const MS_PER_HOUR = 3_600_000;

/** Hours between two instants, or null when the pair is not a usable span. */
export function hoursBetween(from: Date, to: Date | null): number | null {
  if (!to) return null;
  const hours = (to.getTime() - from.getTime()) / MS_PER_HOUR;
  return Number.isFinite(hours) && hours >= 0 ? hours : null;
}

/** Submission-to-resolution durations, dropping cases without a finish line. */
export function resolveHours(
  rows: readonly { submittedAt: Date; resolvedAt: Date | null }[]
): number[] {
  const hours: number[] = [];
  for (const row of rows) {
    const value = hoursBetween(row.submittedAt, row.resolvedAt);
    if (value !== null) hours.push(value);
  }
  return hours;
}

/** Submission-to-closure durations, measured separately from resolving. */
export function closeHours(
  rows: readonly { submittedAt: Date; closedAt: Date | null }[]
): number[] {
  const hours: number[] = [];
  for (const row of rows) {
    const value = hoursBetween(row.submittedAt, row.closedAt);
    if (value !== null) hours.push(value);
  }
  return hours;
}

/** The nearest-rank percentile of an unsorted sample. */
export function percentile(
  values: readonly number[],
  rank: number
): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(rank * sorted.length) - 1)
  );
  return sorted[index] ?? null;
}

export function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Hours as the dashboards print them: one decimal, or null. */
export function roundHours(value: number | null): number | null {
  if (value === null) return null;
  return Math.round(value * 10) / 10;
}

export type DurationSummary = {
  sampleSize: number;
  averageHours: number | null;
  medianHours: number | null;
  p90Hours: number | null;
  fastestHours: number | null;
  slowestHours: number | null;
};

const EMPTY_DURATIONS: DurationSummary = {
  sampleSize: 0,
  averageHours: null,
  medianHours: null,
  p90Hours: null,
  fastestHours: null,
  slowestHours: null,
};

/**
 * A sample of durations, summarised. Raw hours: rounding is the caller's, so a
 * screen can round for its cards and a report can print what it measured.
 */
export function summarizeDurations(hours: readonly number[]): DurationSummary {
  if (hours.length === 0) return EMPTY_DURATIONS;
  const sorted = [...hours].sort((a, b) => a - b);
  return {
    sampleSize: sorted.length,
    averageHours: average(sorted),
    medianHours: percentile(sorted, 0.5),
    p90Hours: percentile(sorted, 0.9),
    fastestHours: sorted[0] ?? null,
    slowestHours: sorted[sorted.length - 1] ?? null,
  };
}

/** Grouped counts, in the order a case list is read rather than alphabetically. */
export function statusTallies(
  counts: ReadonlyMap<string, number>
): { status: CaseStatus; count: number }[] {
  return CASE_STATUSES.map((status) => ({
    status,
    count: counts.get(status) ?? 0,
  }));
}

/** Priority tallies, with the unassessed cases last instead of hidden. */
export function priorityTallies(
  counts: ReadonlyMap<string | null, number>
): { level: PriorityLevel | "UNASSESSED"; count: number }[] {
  const rows: { level: PriorityLevel | "UNASSESSED"; count: number }[] =
    PRIORITY_LEVELS.map((level) => ({
      level,
      count: counts.get(level) ?? 0,
    }));
  rows.push({ level: "UNASSESSED", count: counts.get(null) ?? 0 });
  return rows;
}

/** Office tallies, busiest first, unassigned named rather than numbered. */
export function officeTallies(
  entries: readonly { officeId: number | null; count: number }[],
  names: ReadonlyMap<number, string>
): { id: number | null; name: string; count: number }[] {
  return entries
    .map((row) => ({
      id: row.officeId,
      name:
        row.officeId === null
          ? "Unassigned"
          : names.get(row.officeId) ?? "Unknown",
      count: row.count,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
