// The rules for the planned work window on an assessment (planned start /
// planned finish).
//
// A plan is a statement about work that is still to be done, so neither end of
// the window may be moved into the past. The one exception is a plan that was
// recorded earlier and is being re-saved unchanged: a case that is already
// running keeps the window it was planned with, otherwise re-saving the
// assessment would be impossible.
//
// Pure (no database, no HTTP) so the rules are unit-tested directly. The
// service layer turns the returned message into an API error.

import { manilaDay, todayManila } from "@/lib/cases/action-date";

export type PlanWindowValues = {
  scheduledStartAt: Date | null;
  scheduledEndAt: Date | null;
};

export type PlanWindowInput = PlanWindowValues & {
  /** The window already stored on the assessment, when there is one. */
  existing?: PlanWindowValues | null;
  /** Today in Asia/Manila (YYYY-MM-DD); defaults to the real today. */
  today?: string;
};

/**
 * Why the planned window cannot be saved, or null when it can.
 *
 * The message is written for the person filling the form: it says which field
 * is wrong and what to do about it.
 */
export function planWindowProblem(input: PlanWindowInput): string | null {
  const today = input.today ?? todayManila();
  const { scheduledStartAt, scheduledEndAt } = input;

  if (
    scheduledStartAt &&
    scheduledEndAt &&
    scheduledEndAt.getTime() <= scheduledStartAt.getTime()
  ) {
    return "The planned finish must be after the planned start.";
  }

  if (scheduledStartAt && !keptDay(scheduledStartAt, input.existing?.scheduledStartAt, today)) {
    return `The planned start cannot be in the past. Pick today (${today}) or a later day, or leave it blank.`;
  }

  if (scheduledEndAt && !keptDay(scheduledEndAt, input.existing?.scheduledEndAt, today)) {
    return `The planned finish cannot be in the past. Pick today (${today}) or a later day, or leave it blank.`;
  }

  return null;
}

/** True when the value is today or later, or is the day that was already stored. */
function keptDay(value: Date, stored: Date | null | undefined, today: string): boolean {
  const day = manilaDay(value);
  if (day >= today) return true;
  return stored ? manilaDay(stored) === day : false;
}

/**
 * The earliest instant a *new* planned window may start: midnight today in
 * Manila. Used for the `min` attribute of the two pickers.
 */
export function planWindowFloor(today: string = todayManila()): Date {
  return new Date(`${today}T00:00:00+08:00`);
}
