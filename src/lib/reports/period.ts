import { manilaYear } from "@/lib/privacy/dates";

/**
 * Report periods.
 *
 * Every report screen and export shares one period vocabulary, so "last 90
 * days" means the same thing on the engineering report as it does on the
 * treasury register. Days are Manila days, because that is the day boundary the
 * barangay actually works to: a case submitted at 07:00 on a Tuesday belongs to
 * Tuesday, not to the previous UTC day.
 */

export const DAY_MS = 86_400_000;
/** Asia/Manila has been UTC+8 without daylight saving since 1978. */
export const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

export const REPORT_PERIOD_KEYS = [
  "30d",
  "90d",
  "ytd",
  "12m",
  "custom",
  "all",
] as const;

export type ReportPeriodKey = (typeof REPORT_PERIOD_KEYS)[number];

export interface ReportPeriod {
  key: ReportPeriodKey;
  /** Inclusive lower bound, or null for "everything". */
  from: Date | null;
  /** Inclusive upper bound (end of a Manila day), or null for "now". */
  to: Date | null;
  /** Whole days covered, or null when unbounded. */
  days: number | null;
}

export function isReportPeriodKey(value: unknown): value is ReportPeriodKey {
  return (
    typeof value === "string" &&
    (REPORT_PERIOD_KEYS as readonly string[]).includes(value)
  );
}

/** Midnight at the start of `date`'s Manila day, as a UTC instant. */
export function startOfManilaDay(date: Date): Date {
  const shifted = new Date(date.getTime() + MANILA_OFFSET_MS);
  return new Date(
    Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate()
    ) - MANILA_OFFSET_MS
  );
}

/** The last millisecond of `date`'s Manila day. */
export function endOfManilaDay(date: Date): Date {
  return new Date(startOfManilaDay(date).getTime() + DAY_MS - 1);
}

/** Manila midnight on 1 January of `date`'s year. */
export function startOfManilaYear(date: Date): Date {
  return new Date(Date.UTC(manilaYear(date), 0, 1) - MANILA_OFFSET_MS);
}

/**
 * Parses a `YYYY-MM-DD` day into the start of that Manila day. Anything else —
 * including an outright invalid date like `2026-02-31` — returns null, so a
 * hand-typed query string can never widen or shift a report silently.
 */
export function parseManilaDay(value: string | null | undefined): Date | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day] = match;
  const candidate = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day)) - MANILA_OFFSET_MS
  );
  // Reject rollovers such as 2026-02-31 → 2026-03-03.
  const shifted = new Date(candidate.getTime() + MANILA_OFFSET_MS);
  if (
    shifted.getUTCFullYear() !== Number(year) ||
    shifted.getUTCMonth() !== Number(month) - 1 ||
    shifted.getUTCDate() !== Number(day)
  ) {
    return null;
  }
  return candidate;
}

export interface ReportPeriodInput {
  period?: string | null;
  from?: string | null;
  to?: string | null;
  now?: Date;
}

/**
 * Turns a query string into a concrete period. An unknown key falls back to the
 * 90-day default rather than to "all time": reports should narrow, never
 * silently balloon.
 */
export function resolveReportPeriod(input: ReportPeriodInput = {}): ReportPeriod {
  const now = input.now ?? new Date();
  const key = isReportPeriodKey(input.period) ? input.period : "90d";
  const to = endOfManilaDay(now);
  const days = (count: number) =>
    new Date(startOfManilaDay(now).getTime() - (count - 1) * DAY_MS);

  switch (key) {
    case "30d":
      return { key, from: days(30), to, days: 30 };
    case "90d":
      return { key, from: days(90), to, days: 90 };
    case "ytd": {
      const from = startOfManilaYear(now);
      return {
        key,
        from,
        to,
        days: Math.max(1, Math.ceil((to.getTime() - from.getTime()) / DAY_MS)),
      };
    }
    case "12m":
      return { key, from: days(365), to, days: 365 };
    case "custom": {
      const from = parseManilaDay(input.from);
      const rawTo = parseManilaDay(input.to);
      if (!from && !rawTo) {
        // A custom period with neither bound is just the default window.
        return { key: "90d", from: days(90), to, days: 90 };
      }
      const lower = from;
      const upper = rawTo ? endOfManilaDay(rawTo) : to;
      const span =
        lower === null
          ? null
          : Math.max(1, Math.ceil((upper.getTime() - lower.getTime()) / DAY_MS));
      return { key, from: lower, to: upper, days: span };
    }
    case "all":
    default:
      return { key: "all", from: null, to: null, days: null };
  }
}

/** Prisma-friendly range filter for a DateTime column. */
export function periodRange(
  period: ReportPeriod
): { gte?: Date; lte?: Date } | undefined {
  if (!period.from && !period.to) return undefined;
  return {
    ...(period.from ? { gte: period.from } : {}),
    ...(period.to ? { lte: period.to } : {}),
  };
}

/** Whether an instant falls inside the period (null bounds are open). */
export function inReportPeriod(
  value: Date | null | undefined,
  period: ReportPeriod
): boolean {
  if (!value) return false;
  if (period.from && value.getTime() < period.from.getTime()) return false;
  if (period.to && value.getTime() > period.to.getTime()) return false;
  return true;
}

/**
 * The `YYYY-MM` buckets a period spans, oldest first, in Manila time. Capped so
 * a hand-crafted "all time" query cannot ask for a thousand chart rows.
 */
export function monthKeysForPeriod(period: ReportPeriod, max = 24): string[] {
  const end = period.to ?? new Date();
  const start = period.from ?? new Date(end.getTime() - (max - 1) * 30 * DAY_MS);
  const cursor = startOfManilaDay(start);
  const last = startOfManilaDay(end);
  const keys: string[] = [];
  while (cursor.getTime() <= last.getTime() && keys.length < max) {
    const shifted = new Date(cursor.getTime() + MANILA_OFFSET_MS);
    keys.push(
      `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`
    );
    const next = new Date(
      Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 1) -
        MANILA_OFFSET_MS
    );
    cursor.setTime(next.getTime());
  }
  return keys;
}

/** `YYYY-MM` for an instant, in Manila time. */
export function monthKeyOf(value: Date): string {
  const shifted = new Date(value.getTime() + MANILA_OFFSET_MS);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** `YYYY-MM-DD` for an instant, in Manila time. */
export function dayKeyOf(value: Date): string {
  return new Date(value.getTime() + MANILA_OFFSET_MS).toISOString().slice(0, 10);
}
