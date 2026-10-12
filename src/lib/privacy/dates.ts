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
