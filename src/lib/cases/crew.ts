// Crew assignment: who is working on a case, and whether they can be there.
//
// Two layers in one module, on purpose:
//   * pure window arithmetic + coverage rules (unit tested without a database)
//   * transaction-bound services used by the API routes
// The module never imports `@/lib/db`, so the pure half stays testable.

import { refreshCaseLabour } from "@/lib/cases/labour";
import type { Prisma } from "@prisma/client";
import { createApiError } from "@/lib/api";
import { canManageConcern, type WorkflowActor } from "@/lib/cases/workflow";
import { crewCoverage } from "@/lib/cases/manpower";
import { notifyCrewAssigned } from "@/lib/notifications/service";
import { formatDateTime } from "@/lib/format";

type Tx = Prisma.TransactionClient;

// ------------------------------------------------------------ pure rules
// Re-exported from crew-rules.ts so callers have one import for the whole crew
// domain (the rules module stays dependency-free for the unit tests).

export {
  conflictMessage,
  findCrewConflicts,
  remainingCrewSlots,
  windowsOverlap,
  type CrewBooking,
  type CrewConflict,
  type CrewWindow,
} from "@/lib/cases/crew-rules";

import {
  conflictMessage,
  findCrewConflicts,
  remainingCrewSlots,
  type CrewBooking,
  type CrewWindow,
} from "@/lib/cases/crew-rules";

// ------------------------------------------------------------ tx services

export const OPEN_CASE_STATUSES = [
  "SUBMITTED",
  "ASSIGNED",
  "UNDER_ASSESSMENT",
  "AWAITING_BUDGET",
  "IN_PROGRESS",
  "RESOLVED",
] as const;

/** Cases where a crew booking is still "live" for double-booking purposes. */
const BOOKING_STATUSES = ["ASSIGNED", "UNDER_ASSESSMENT", "AWAITING_BUDGET", "IN_PROGRESS"];

export type CrewMemberView = {
  id: number;
  name: string;
  trade: string | null;
  tradeLabel: string | null;
  availability: string;
  employmentType: string;
  dailyRate: string | null;
  hourlyRate: string | null;
  maxConcurrentCases: number;
  openAssignments: number;
  /** The office the roster profile belongs to; null for unassigned crew. */
  officeId: number | null;
  officeName: string | null;
  /** True when this person works for a different office than the case's. */
  otherOffice: boolean;
};

type ConcernForCrew = {
  id: number;
  caseNumber: string;
  status: string;
  assignedOfficeId: number | null;
  workersNeeded: number | null;
};

async function loadConcernForCrew(
  tx: Tx,
  concernId: number,
  actor: WorkflowActor
): Promise<ConcernForCrew> {
  const concern = await tx.concern.findUnique({
    where: { id: concernId },
    select: {
      id: true,
      caseNumber: true,
      status: true,
      assignedOfficeId: true,
      caseAssessment: { select: { workersNeeded: true } },
    },
  });
  if (!concern) throw createApiError.notFound("Concern not found.");
  if (!canManageConcern(actor, concern)) {
    throw createApiError.forbidden("This concern is assigned to another office.");
  }
  if (concern.status === "RESOLVED" || concern.status === "CLOSED") {
    throw createApiError.conflict(
      concern.status === "CLOSED"
        ? "Closed cases cannot be modified."
        : "Resolved cases can no longer be staffed."
    );
  }

  return {
    id: concern.id,
    caseNumber: concern.caseNumber,
    status: concern.status,
    assignedOfficeId: concern.assignedOfficeId,
    workersNeeded: concern.caseAssessment?.workersNeeded ?? null,
  };
}

/** Active crew on a case, newest assignment first. */
export async function listCrewAssignments(tx: Tx, concernId: number) {
  return tx.crewAssignment.findMany({
    where: { concernId },
    orderBy: [{ isActive: "desc" }, { assignedAt: "asc" }],
    include: {
      crew: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          crewProfile: { select: { trade: true, availability: true, dailyRate: true } },
        },
      },
    },
  });
}

export type CrewProgress = {
  required: number | null;
  assigned: number;
  satisfied: boolean;
  shortfall: number;
  label: string;
};

/** "2 of 3 assigned" plus the numbers the gate needs. */
export async function crewProgress(
  tx: Tx,
  concernId: number
): Promise<CrewProgress> {
  const [assessment, active] = await Promise.all([
    tx.caseAssessment.findUnique({
      where: { concernId },
      select: { workersNeeded: true },
    }),
    tx.crewAssignment.count({ where: { concernId, isActive: true } }),
  ]);

  const coverage = crewCoverage({
    required: assessment?.workersNeeded ?? null,
    assigned: active,
  });

  return {
    required: assessment?.workersNeeded ?? null,
    assigned: active,
    satisfied: coverage.satisfied,
    shortfall: coverage.shortfall,
    label: coverage.label,
  };
}

/**
 * The gate that guards IN_PROGRESS: work may not start until the planned crew
 * is actually assigned. A legacy case without a completed assessment has no
 * plan, so it is not gated (the caller flags it instead).
 */
export async function assertCrewGate(
  tx: Tx,
  concernId: number
): Promise<CrewProgress> {
  const progress = await crewProgress(tx, concernId);
  if (progress.required !== null && !progress.satisfied) {
    throw createApiError.conflict(
      `Assign the planned crew before starting work: ${progress.label}. ` +
        "Use the crew panel, or record a crew-shortfall override with a reason."
    );
  }
  return progress;
}

export type AssignCrewInput = {
  concernId: number;
  actor: WorkflowActor;
  crewIds: number[];
  taskNote?: string | null;
  scheduledStartAt?: Date | null;
  scheduledEndAt?: Date | null;
};

export type AssignCrewOutcome = {
  concernId: number;
  caseNumber: string;
  assigned: CrewMemberView[];
  progress: CrewProgress;
};

/**
 * Assigns named crew to a case.
 *
 * Enforced here, inside the caller's transaction:
 *   * only active CREW accounts with an active profile
 *   * never more people than the plan needs
 *   * nobody already booked on overlapping work on another open case
 */
export async function assignCrew(
  tx: Tx,
  input: AssignCrewInput
): Promise<AssignCrewOutcome> {
  const concern = await loadConcernForCrew(tx, input.concernId, input.actor);

  const uniqueIds = [...new Set(input.crewIds)];
  if (uniqueIds.length === 0) {
    throw createApiError.badRequest("Select at least one crew member.");
  }

  const people = await tx.user.findMany({
    where: {
      id: { in: uniqueIds },
      isActive: true,
      role: { key: "CREW" },
      crewProfile: { is: { isActive: true } },
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      crewProfile: {
        select: {
          trade: true,
          availability: true,
          employmentType: true,
          dailyRate: true,
          hourlyRate: true,
          maxConcurrentCases: true,
        },
      },
    },
  });
  if (people.length !== uniqueIds.length) {
    throw createApiError.badRequest(
      "One or more selected crew members are inactive or no longer on the roster."
    );
  }

  const unavailable = people.filter(
    (person) => person.crewProfile?.availability !== "AVAILABLE"
  );
  if (unavailable.length > 0) {
    throw createApiError.conflict(
      `${unavailable
        .map((person) => `${person.firstName} ${person.lastName}`)
        .join(", ")} ${
        unavailable.length === 1 ? "is" : "are"
      } not available for assignment.`
    );
  }

  const alreadyAssigned = await tx.crewAssignment.findMany({
    where: { concernId: concern.id, isActive: true },
    select: { crewId: true },
  });
  const activeCrewIds = new Set(alreadyAssigned.map((row) => row.crewId));
  const incoming = uniqueIds.filter((id) => !activeCrewIds.has(id));

  if (incoming.length > 0) {
    const slots = remainingCrewSlots({
      workersNeeded: concern.workersNeeded,
      activeCrew: activeCrewIds.size,
      requested: incoming.length,
    });
    if (!slots.allowed) {
      throw createApiError.badRequest(
        concern.workersNeeded === null
          ? `This case already has ${activeCrewIds.size} crew assigned.`
          : `This case needs ${concern.workersNeeded} crew — ${slots.remaining} more ${
              slots.remaining === 1 ? "slot is" : "slots are"
            } free. Raise the plan in the assessment instead.`
      );
    }

    const window: CrewWindow = {
      startAt: input.scheduledStartAt ?? null,
      endAt: input.scheduledEndAt ?? null,
    };

    // Serialise assignments per person: lock the crew members' user rows (in id
    // order, so concurrent calls cannot deadlock) before reading their bookings.
    // Without the lock, two officials booking the same person at the same moment
    // could both pass the overlap check.
    await tx.$queryRaw`
      SELECT "id" FROM "User"
      WHERE "id" = ANY(${incoming}::int[])
      ORDER BY "id"
      FOR UPDATE`;

    const bookings = await tx.crewAssignment.findMany({
      where: {
        crewId: { in: incoming },
        isActive: true,
        concernId: { not: concern.id },
        concern: { status: { in: BOOKING_STATUSES } },
      },
      select: {
        crewId: true,
        concernId: true,
        scheduledStartAt: true,
        scheduledEndAt: true,
        concern: {
          select: {
            caseNumber: true,
            caseAssessment: {
              select: { scheduledStartAt: true, scheduledEndAt: true },
            },
          },
        },
      },
    });

    const normalized: CrewBooking[] = bookings.map((booking) => ({
      crewId: booking.crewId,
      concernId: booking.concernId,
      caseNumber: booking.concern.caseNumber,
      startAt:
        booking.scheduledStartAt ??
        booking.concern.caseAssessment?.scheduledStartAt ??
        null,
      endAt:
        booking.scheduledEndAt ??
        booking.concern.caseAssessment?.scheduledEndAt ??
        null,
    }));

    // The candidate window is the assignment window; with none given it falls
    // back to the case's planned window. A booking must have both ends: an
    // open-ended booking would block the person from every other case
    // indefinitely, so it is refused rather than guessed at.
    const assessmentWindow = await tx.caseAssessment.findUnique({
      where: { concernId: concern.id },
      select: { scheduledStartAt: true, scheduledEndAt: true },
    });
    const candidate: CrewWindow = {
      startAt: window.startAt ?? assessmentWindow?.scheduledStartAt ?? null,
      endAt: window.endAt ?? assessmentWindow?.scheduledEndAt ?? null,
    };
    if (!candidate.startAt || !candidate.endAt) {
      throw createApiError.badRequest(
        "Set the planned start and finish for this crew booking, or on the case's assessment, before assigning crew."
      );
    }

    const conflicts = findCrewConflicts({
      bookings: normalized,
      candidate,
      crewIds: incoming,
      concernId: concern.id,
    });
    if (conflicts.length > 0) {
      throw createApiError.conflict(conflictMessage(conflicts));
    }

    for (const crewId of incoming) {
      const existing = await tx.crewAssignment.findUnique({
        where: { concernId_crewId: { concernId: concern.id, crewId } },
      });

      if (existing) {
        // Re-assigning someone who was released reuses their row.
        await tx.crewAssignment.update({
          where: { id: existing.id },
          data: {
            isActive: true,
            releasedAt: null,
            releasedById: null,
            releaseReason: null,
            assignedById: input.actor.id,
            assignedAt: new Date(),
            taskNote: input.taskNote ?? existing.taskNote,
            scheduledStartAt: input.scheduledStartAt ?? existing.scheduledStartAt,
            scheduledEndAt: input.scheduledEndAt ?? existing.scheduledEndAt,
          },
        });
      } else {
        await tx.crewAssignment.create({
          data: {
            concernId: concern.id,
            crewId,
            taskNote: input.taskNote ?? null,
            scheduledStartAt: input.scheduledStartAt ?? null,
            scheduledEndAt: input.scheduledEndAt ?? null,
            assignedById: input.actor.id,
          },
        });
      }
    }

    await tx.caseStatusHistory.create({
      data: {
        concernId: concern.id,
        entryType: "CREW_ASSIGNMENT",
        fromStatus: concern.status,
        toStatus: concern.status,
        remarks: `${incoming.length} crew member${
          incoming.length === 1 ? "" : "s"
        } assigned to this case.`,
        visibility: "RESIDENT_VISIBLE",
        metadataJson: JSON.stringify({
          crewIds: incoming,
          scheduledStartAt: input.scheduledStartAt?.toISOString() ?? null,
          scheduledEndAt: input.scheduledEndAt?.toISOString() ?? null,
          taskNote: input.taskNote ?? null,
        }),
        actorId: input.actor.id,
        actorRole: input.actor.roleKey,
      },
    });

    // The assigned crew members are told through the existing notification
    // contract — the same machine-written row the SLA job uses with the frozen
    // `NOTIFICATION_TYPES` set, never a new type and never a free-form message.
    // The crew portal lists the job, but someone who is not looking at the app
    // has to be told they were put on it.
    const schedule = input.scheduledStartAt
      ? ` Scheduled ${formatDateTime(input.scheduledStartAt)}.`
      : "";
    for (const crewId of incoming) {
      await notifyCrewAssigned(tx, {
        userId: crewId,
        concernId: concern.id,
        caseNumber: concern.caseNumber,
        schedule,
      });
    }
  }

  const [rows, progress] = await Promise.all([
    listCrewAssignments(tx, concern.id),
    crewProgress(tx, concern.id),
  ]);

  await refreshCaseLabour(tx, concern.id);

  // Everyone now booked on the case, in the same shape the picker uses: rates,
  // availability, the office the person belongs to and their open caseload all
  // come from the roster, so the two lists can never drift apart.
  const booked = new Set(
    rows.filter((row) => row.isActive).map((row) => row.crew.id)
  );
  const roster = await listCrewRoster(tx, {
    officeId: concern.assignedOfficeId,
    includeOtherOffices: true,
  });

  return {
    concernId: concern.id,
    caseNumber: concern.caseNumber,
    assigned: roster.filter((member) => booked.has(member.id)),
    progress,
  };
}

export type ReleaseCrewInput = {
  concernId: number;
  actor: WorkflowActor;
  crewId: number;
  reason: string;
};

/** Releases one crew member. The row stays for the assignment history. */
export async function releaseCrew(
  tx: Tx,
  input: ReleaseCrewInput
): Promise<{ concernId: number; caseNumber: string; progress: CrewProgress }> {
  const concern = await loadConcernForCrew(tx, input.concernId, input.actor);

  const assignment = await tx.crewAssignment.findUnique({
    where: { concernId_crewId: { concernId: concern.id, crewId: input.crewId } },
    include: { crew: { select: { firstName: true, lastName: true } } },
  });
  if (!assignment || !assignment.isActive) {
    throw createApiError.notFound("That crew member is not assigned to this case.");
  }

  await tx.crewAssignment.update({
    where: { id: assignment.id },
    data: {
      isActive: false,
      releasedAt: new Date(),
      releasedById: input.actor.id,
      releaseReason: input.reason,
    },
  });

  await tx.caseStatusHistory.create({
    data: {
      concernId: concern.id,
      entryType: "CREW_ASSIGNMENT",
      fromStatus: concern.status,
      toStatus: concern.status,
      remarks: `${assignment.crew.firstName} ${assignment.crew.lastName} released from this case. Reason: ${input.reason}`,
      visibility: "RESIDENT_VISIBLE",
      metadataJson: JSON.stringify({
        released: [input.crewId],
        reason: input.reason,
      }),
      actorId: input.actor.id,
      actorRole: input.actor.roleKey,
    },
  });

  await refreshCaseLabour(tx, concern.id);
  return {
    concernId: concern.id,
    caseNumber: concern.caseNumber,
    progress: await crewProgress(tx, concern.id),
  };
}

/**
 * Crew roster for the assignment picker: everyone active, with how many open
 * cases they currently hold so the official can see who is free.
 *
 * `officeId` names the office the case belongs to. With `includeOtherOffices`
 * the roster also carries profiled crew from other offices, flagged with
 * `otherOffice` and listed after the case's own people — a case routed to an
 * office with no crew of its own is then not a dead end.
 */
export async function listCrewRoster(
  tx: Tx,
  options: {
    officeId?: number | null;
    includeOtherOffices?: boolean;
  } = {}
): Promise<CrewMemberView[]> {
  const caseOfficeId = options.officeId ?? null;
  const rows = await tx.user.findMany({
    where: {
      isActive: true,
      role: { key: "CREW" },
      crewProfile: { is: { isActive: true } },
      ...(caseOfficeId && !options.includeOtherOffices
        ? {
            OR: [{ officeId: caseOfficeId }, { crewProfile: { is: { officeId: caseOfficeId } } }],
          }
        : {}),
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      officeId: true,
      office: { select: { id: true, name: true } },
      crewProfile: {
        select: {
          trade: true,
          availability: true,
          employmentType: true,
          dailyRate: true,
          hourlyRate: true,
          maxConcurrentCases: true,
          officeId: true,
          office: { select: { id: true, name: true } },
        },
      },
      _count: {
        select: {
          // User.crewJobs is the CrewAssignment.crew back-relation.
          crewJobs: {
            where: { isActive: true, concern: { status: { in: BOOKING_STATUSES } } },
          },
        },
      },
    },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    take: 200,
  });

  const roster = rows.map((row) => {
    const office = row.crewProfile?.office ?? row.office;
    return {
      id: row.id,
      name: `${row.firstName} ${row.lastName}`,
      trade: row.crewProfile?.trade ?? null,
      tradeLabel: row.crewProfile?.trade ?? null,
      availability: row.crewProfile?.availability ?? "AVAILABLE",
      employmentType: row.crewProfile?.employmentType ?? "JOB_ORDER",
      dailyRate: row.crewProfile?.dailyRate?.toString() ?? null,
      hourlyRate: row.crewProfile?.hourlyRate?.toString() ?? null,
      maxConcurrentCases: row.crewProfile?.maxConcurrentCases ?? 1,
      openAssignments: row._count.crewJobs,
      officeId: office?.id ?? null,
      officeName: office?.name ?? null,
      otherOffice: caseOfficeId !== null && office !== null && office.id !== caseOfficeId,
    };
  });

  // The case's own crew come first; the rest of the roster follows, so a
  // widened picker still leads with the people the office already works with.
  return roster.sort((a, b) => {
    if (a.otherOffice !== b.otherOffice) return a.otherOffice ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
}

export type CrewDeskRow = {
  userId: number;
  name: string;
  email: string;
  /** The account itself: a disabled account cannot sign in or be assigned. */
  isActive: boolean;
  officeId: number | null;
  officeName: string | null;
  hasProfile: boolean;
  profileIsActive: boolean | null;
  trade: string | null;
  employmentType: string | null;
  hourlyRate: string | null;
  dailyRate: string | null;
  availability: string | null;
  maxConcurrentCases: number | null;
  notes: string | null;
  openAssignments: number;
};

/**
 * Every crew account for the admin roster desk: profiled or not, active or
 * disabled. The picker only wants working crew, but the desk has to be able to
 * profile a new person and to switch somebody back on, so it sees them all.
 */
export async function listCrewDesk(tx: Tx): Promise<CrewDeskRow[]> {
  const rows = await tx.user.findMany({
    where: { role: { key: "CREW" } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      isActive: true,
      officeId: true,
      office: { select: { id: true, name: true } },
      crewProfile: {
        include: { office: { select: { id: true, name: true } } },
      },
      _count: {
        select: {
          crewJobs: {
            where: { isActive: true, concern: { status: { in: BOOKING_STATUSES } } },
          },
        },
      },
    },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    take: 500,
  });

  return rows.map((row) => {
    // The roster profile owns the work office; the account's own office is the
    // fallback for somebody who has not been profiled yet.
    const office = row.crewProfile?.office ?? row.office;
    return {
      userId: row.id,
      name: `${row.firstName} ${row.lastName}`,
      email: row.email,
      isActive: row.isActive,
      officeId: office?.id ?? null,
      officeName: office?.name ?? null,
      hasProfile: row.crewProfile !== null,
      profileIsActive: row.crewProfile?.isActive ?? null,
      trade: row.crewProfile?.trade ?? null,
      employmentType: row.crewProfile?.employmentType ?? null,
      hourlyRate: row.crewProfile?.hourlyRate?.toString() ?? null,
      dailyRate: row.crewProfile?.dailyRate?.toString() ?? null,
      availability: row.crewProfile?.availability ?? null,
      maxConcurrentCases: row.crewProfile?.maxConcurrentCases ?? null,
      notes: row.crewProfile?.notes ?? null,
      openAssignments: row._count.crewJobs,
    };
  });
}

/** A crew member's own jobs, for the crew portal. */
export async function listCrewJobs(tx: Tx, crewId: number) {
  return tx.crewAssignment.findMany({
    where: {
      crewId,
      isActive: true,
      concern: { status: { in: BOOKING_STATUSES } },
    },
    orderBy: [{ scheduledStartAt: "asc" }, { assignedAt: "asc" }],
    include: {
      concern: {
        select: {
          id: true,
          caseNumber: true,
          title: true,
          status: true,
          locationAddress: true,
          locationPurok: true,
          locationLat: true,
          locationLng: true,
          assignedOffice: { select: { name: true } },
          caseAssessment: {
            select: {
              workersNeeded: true,
              estimatedDurationMinutes: true,
              equipmentNotes: true,
              scheduledStartAt: true,
              scheduledEndAt: true,
            },
          },
        },
      },
    },
  });
}
