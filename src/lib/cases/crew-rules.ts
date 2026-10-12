// Pure crew-scheduling rules: window overlap, double-booking detection and
// how many slots a plan still has. Kept in its own module (no database, no
// framework imports) so the arithmetic is unit testable; `crew.ts` re-exports
// everything here.

import { MAX_WORKERS_NEEDED } from "@/lib/cases/manpower";

export type CrewWindow = {
  /** null start = open (already running / unknown start). */
  startAt: Date | null;
  /** null end = open (no planned finish yet). */
  endAt: Date | null;
};

export type CrewBooking = {
  crewId: number;
  concernId: number;
  caseNumber?: string;
  startAt: Date | null;
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

export type CrewConflict = {
  crewId: number;
  concernId: number;
  caseNumber: string | null;
};

/**
 * Double-booking check. `bookings` are the crew's other active assignments on
 * cases that are still open; the candidate is the window this assignment would
 * occupy. Assignments on the same case are never conflicts.
 */
export function findCrewConflicts(input: {
  bookings: CrewBooking[];
  candidate: CrewWindow;
  crewIds: number[];
  concernId: number;
}): CrewConflict[] {
  const wanted = new Set(input.crewIds);
  const conflicts: CrewConflict[] = [];

  for (const booking of input.bookings) {
    if (!wanted.has(booking.crewId)) continue;
    if (booking.concernId === input.concernId) continue;
    if (!windowsOverlap(input.candidate, booking)) continue;
    conflicts.push({
      crewId: booking.crewId,
      concernId: booking.concernId,
      caseNumber: booking.caseNumber ?? null,
    });
  }

  return conflicts;
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

/** Human summary of a conflict list, for the 409 the official sees. */
export function conflictMessage(conflicts: CrewConflict[]): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const conflict of conflicts) {
    const key = `${conflict.crewId}:${conflict.concernId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(
      conflict.caseNumber
        ? `${conflict.caseNumber} (crew #${conflict.crewId})`
        : `case #${conflict.concernId} (crew #${conflict.crewId})`
    );
  }
  return `Crew already booked on overlapping work: ${parts.join(", ")}. Release them or pick other people.`;
}
