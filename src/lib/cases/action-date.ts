// Calendar-day rules for the case journal.
//
// Officials record when an action really happened as a calendar day in
// Asia/Manila (YYYY-MM-DD). That "date of action" is stored separately from the
// system timestamp (createdAt), which is always the moment an entry was made and
// can never be backdated. Stored values sit at midday Manila time so the day
// cannot drift across timezone boundaries.
//
// This module is pure (no database or HTTP imports) so the rules can be unit
// tested directly. The service layer turns the reported problems into API errors.

export const APP_TIME_ZONE = "Asia/Manila";

export const CALENDAR_DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const DAY_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** True when `value` is a real calendar date in YYYY-MM-DD form (e.g. not 2026-02-30). */
export function isValidCalendarDay(value: string): boolean {
  const match = CALENDAR_DAY_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** The Asia/Manila calendar day (YYYY-MM-DD) of an instant. */
export function manilaDay(instant: Date | string): string {
  return DAY_FORMAT.format(new Date(instant));
}

/** Today's calendar day in Asia/Manila. */
export function todayManila(now: Date = new Date()): string {
  return manilaDay(now);
}

/** Stored timestamp for a calendar day: midday in Asia/Manila. */
export function actionDateForDay(day: string): Date {
  return new Date(`${day}T12:00:00+08:00`);
}

/**
 * The day a journal entry is dated to: its recorded action date when it has
 * one, otherwise the day it was recorded (automated entries).
 */
export function journalDay(entry: { occurredOn: Date | null; createdAt: Date }): string {
  return manilaDay(entry.occurredOn ?? entry.createdAt);
}

/** Entries that actually move the case from one status to another. */
export function isStatusTransition(entry: {
  fromStatus: string | null;
  toStatus: string | null;
}): boolean {
  return entry.toStatus !== null && entry.fromStatus !== entry.toStatus;
}

/**
 * Latest calendar day on which the case's status changed, or null when the
 * journal has no status transitions yet.
 */
export function lastStatusChangeDay(
  entries: Array<{
    fromStatus: string | null;
    toStatus: string | null;
    occurredOn: Date | null;
    createdAt: Date;
  }>
): string | null {
  let latest: string | null = null;
  for (const entry of entries) {
    if (!isStatusTransition(entry)) continue;
    const day = journalDay(entry);
    if (latest === null || day > latest) latest = day;
  }
  return latest;
}

export type ActionDateProblem = "future" | "before-submission" | "before-last-status";

export type ActionDateBounds = {
  /** Today in Asia/Manila (YYYY-MM-DD). */
  today: string;
  /** Calendar day the concern was submitted (YYYY-MM-DD). */
  submittedDay: string;
  /** Latest day the status changed, or null when it never has. */
  lastStatusDay: string | null;
};

/**
 * Checks a requested action day against the case timeline. Returns the first
 * problem found, or null when the day is acceptable.
 *
 * - Nothing can happen in the future.
 * - Nothing can happen before the case was submitted.
 * - A status change cannot be dated before the previous status change, so the
 *   stepper's dates stay in order. Remarks and actions are not held to this.
 */
export function actionDateProblem(
  day: string,
  bounds: ActionDateBounds,
  options: { statusChange: boolean }
): ActionDateProblem | null {
  if (day > bounds.today) return "future";
  if (day < bounds.submittedDay) return "before-submission";
  if (options.statusChange && bounds.lastStatusDay !== null && day < bounds.lastStatusDay) {
    return "before-last-status";
  }
  return null;
}

/**
 * Earliest calendar day an official may pick for a new entry on this case.
 * Status changes are bounded by the previous status change; other entries only
 * by the submission day.
 */
export function earliestActionDay(
  bounds: Pick<ActionDateBounds, "submittedDay" | "lastStatusDay">,
  options: { statusChange: boolean }
): string {
  if (options.statusChange && bounds.lastStatusDay !== null) {
    return bounds.lastStatusDay > bounds.submittedDay
      ? bounds.lastStatusDay
      : bounds.submittedDay;
  }
  return bounds.submittedDay;
}
