// Date arithmetic for data subject requests (RA 10173).
//
// The IRR gives the personal data controller 15 *working* days to respond to a
// data subject request, so the deadline skips weekends. Philippine special
// holidays are not embedded: a government deployment can pass its own list to
// `addWorkingDays`, and the recorded `dueAt` is only ever advisory — the
// request queue shows overdue items regardless.

export const DSR_STATUTORY_WORKING_DAYS = 15;

const MANILA_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Manila",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

/**
 * Adds working days to a date. Iteration is in UTC so a server in any time
 * zone computes the same deadline. `holidays` accepts `YYYY-MM-DD` strings.
 */
export function addWorkingDays(
  from: Date,
  days: number,
  holidays: readonly string[] = []
): Date {
  const holidaySet = new Set(holidays);
  const result = new Date(from.getTime());
  let remaining = Math.max(0, Math.trunc(days));

  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1);
    if (isWeekend(result)) continue;
    if (holidaySet.has(result.toISOString().slice(0, 10))) continue;
    remaining -= 1;
  }
  return result;
}

/** Working days elapsed between two instants (negative when `to` is earlier). */
export function workingDaysBetween(
  from: Date,
  to: Date,
  holidays: readonly string[] = []
): number {
  const holidaySet = new Set(holidays);
  const forward = to.getTime() >= from.getTime();
  const [start, end] = forward ? [from, to] : [to, from];

  const cursor = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())
  );
  const last = Date.UTC(
    end.getUTCFullYear(),
    end.getUTCMonth(),
    end.getUTCDate()
  );

  let count = 0;
  while (cursor.getTime() < last) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (isWeekend(cursor)) continue;
    if (holidaySet.has(cursor.toISOString().slice(0, 10))) continue;
    count += 1;
  }
  return forward ? count : -count;
}

/** Calendar year in Asia/Manila, used for reference codes. */
export function manilaYear(date: Date = new Date()): number {
  return Number(MANILA_DATE.format(date).slice(0, 4));
}

export function dsrReferencePrefix(year: number): string {
  return `DSR-${year}-`;
}

/** e.g. `DSR-2026-0007`. */
export function formatDsrReference(year: number, sequence: number): string {
  return `${dsrReferencePrefix(year)}${String(Math.max(1, Math.trunc(sequence))).padStart(4, "0")}`;
}

/** Human deadline label (`15 working days`, used in resident-facing copy). */
export function dsrDeadlineLabel(): string {
  return `${DSR_STATUTORY_WORKING_DAYS} working days`;
}

/* --------------------------------------------------------------- the warning */

/**
 * How many working days before the deadline the staff desks start warning.
 *
 * The deadline itself is a hard date; this is the "you will not have time if you
 * start now" margin, expressed in the same working-day clock the IRR uses.
 */
export const DSR_WARNING_WORKING_DAYS = 3;

export type DsrDeadlineState = "none" | "open" | "due_soon" | "late";

/** Working days until the deadline; negative once it has passed, 0 on the day. */
export function dsrWorkingDaysRemaining(
  dueAt: Date,
  now: Date = new Date(),
  holidays: readonly string[] = []
): number {
  return workingDaysBetween(now, dueAt, holidays);
}

/**
 * Where a request stands against its deadline.
 *
 * `none` means there is nothing to warn about — no deadline was recorded, or the
 * request has already been decided. Otherwise the deadline *instant* decides
 * lateness, exactly as the request queue, the counts and the report's overdue
 * figure already do (one clock, one answer), and the working-day window decides
 * whether it is close enough to warn about.
 */
export function dsrDeadlineState(input: {
  dueAt: Date | null | undefined;
  resolvedAt?: Date | null;
  now?: Date;
  warningWorkingDays?: number;
  holidays?: readonly string[];
}): DsrDeadlineState {
  const dueAt = input.dueAt ?? null;
  if (dueAt === null) return "none";
  if (input.resolvedAt) return "none";

  const now = input.now ?? new Date();
  const warning = input.warningWorkingDays ?? DSR_WARNING_WORKING_DAYS;

  if (dueAt.getTime() < now.getTime()) return "late";

  const remaining = dsrWorkingDaysRemaining(dueAt, now, input.holidays ?? []);
  if (remaining <= warning) return "due_soon";
  return "open";
}
