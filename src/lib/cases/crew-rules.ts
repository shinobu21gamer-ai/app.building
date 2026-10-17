// Pure crew rules: window overlap and how many slots a plan still has.
// Kept in its own module (no database, no framework imports) so the
// arithmetic is unit testable; `crew.ts` re-exports everything here.

import { MAX_WORKERS_NEEDED } from "@/lib/cases/manpower";

export type CrewWindow = {
  /** null start = open (already running / unknown start). */
  startAt: Date | null;
  /** null end = open (no planned finish yet). */
  endAt: Date | null;
};

/**
 * Whether two work windows overlap. An open bound means "unbounded": a booking
 * with no end conflicts with everything after its start. Windows that merely
 * touch (one ends exactly when the next starts) do not conflict, which is what
 * a two-shift day looks like in practice.
 */
export function windowsOverlap(a: CrewWindow, b: CrewWindow): boolean {
  const aStart = a.startAt ? a.startAt.getTime() : Number.NEGATIVE_INFINITY;
  const aEnd = a.endAt ? a.endAt.getTime() : Number.POSITIVE_INFINITY;
  const bStart = b.startAt ? b.startAt.getTime() : Number.NEGATIVE_INFINITY;
  const bEnd = b.endAt ? b.endAt.getTime() : Number.POSITIVE_INFINITY;

  return aStart < bEnd && bStart < aEnd;
}

/** How many more people a case may take, given the plan and current bookings. */
export function remainingCrewSlots(input: {
  workersNeeded: number | null;
  activeCrew: number;
  requested: number;
}): { allowed: boolean; remaining: number } {
  if (input.workersNeeded === null) {
    return {
      allowed: input.activeCrew + input.requested <= MAX_WORKERS_NEEDED,
      remaining: MAX_WORKERS_NEEDED - input.activeCrew,
    };
  }
  const remaining = Math.max(0, input.workersNeeded - input.activeCrew);
  return { allowed: input.requested <= remaining, remaining };
}
