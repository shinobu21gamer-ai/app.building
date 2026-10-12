import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { appendAuditEntry, appendAuditEntryStandalone } from "@/lib/audit/store";
import { HISTORY_ENTRY_SLA_BREACH } from "@/lib/cases/workflow";
// The frozen notification service is *called*, never modified: the SLA_BREACHED
// catalogue entry and the `Notification` rows it feeds are the same contract the
// pre-revamp scanner used (docs/revamp/01-architecture.md §4).
import { notifySlaBreached } from "@/lib/notifications/service";
import {
  SLA_MAX_ESCALATION_LEVEL,
  SLA_OPEN_STAGES,
  escalationDedupeKey,
  escalationLevelFor,
  escalationLevelLabel,
  hoursBetween,
  isSlaOpenStage,
  recipientRoles,
  resolveSlaWindow,
  slaDueAt,
  summarizeEscalations,
  type EscalationCounts,
  type SlaPolicyLike,
  type SlaScope,
} from "./policy";

// The 48-hour escalation job.
//
// Two layers: `planEscalations` is pure and decides *what* should be written
// (it is what the unit tests exercise), and the database functions below do the
// writing inside transactions, one case at a time, so a failure on one case
// cannot abort the run for the others.

export type SlaRunTrigger = "CRON" | "MANUAL" | "ADMIN";

/** Cases inspected per run. The scan is ordered oldest-stage-first. */
export const SLA_SCAN_LIMIT = 500;

export const SLA_JOB = "SLA_ESCALATION";

export type SlaCaseLike = {
  id: number;
  caseNumber: string;
  status: string;
  stageEnteredAt: Date;
  slaDueAt: Date | null;
  typeId: number | null;
  priorityLevel: string | null;
  userId: number;
};

export type PlannedEscalation = {
  concernId: number;
  caseNumber: string;
  stage: string;
  level: number;
  /** The window in force for this case. */
  hours: number;
  /** How late the case was when the level fired. */
  hoursOverdue: number;
  dueAt: Date;
  policyId: number | null;
  escalateToRole: string;
  recipientRoles: string[];
  dedupeKey: string;
  residentUserId: number;
};

/**
 * Decides the escalation rows a run should write: one per missing level, per
 * case. `existingKeys` carries the `CaseEscalation.dedupeKey` values already in
 * the database, so re-running the job writes nothing twice.
 */
export function planEscalations(input: {
  cases: readonly SlaCaseLike[];
  policies: readonly SlaPolicyLike[];
  now: Date;
  existingKeys: ReadonlySet<string>;
  maxLevel?: number;
}): PlannedEscalation[] {
  const planned: PlannedEscalation[] = [];

  for (const item of input.cases) {
    if (!isSlaOpenStage(item.status)) continue;

    const { policy, hours } = resolveSlaWindow(input.policies, {
      stage: item.status,
      typeId: item.typeId,
      priorityLevel: item.priorityLevel,
    });
    const dueAt = item.slaDueAt ?? slaDueAt(item.stageEnteredAt, hours);
    const level = escalationLevelFor({
      dueAt,
      now: input.now,
      hours,
      maxLevel: input.maxLevel,
    });
    if (level === 0) continue;

    const roles = recipientRoles(policy);
    const overdueNow = hoursBetween(dueAt, input.now);

    for (let current = 1; current <= level; current += 1) {
      const dedupeKey = escalationDedupeKey(item.id, item.status, current);
      if (input.existingKeys.has(dedupeKey)) continue;
      planned.push({
        concernId: item.id,
        caseNumber: item.caseNumber,
        stage: item.status,
        level: current,
        hours,
        // A level that was already missed when the job first ran is recorded at
        // the moment it should have fired, not at today's overdue count.
        hoursOverdue: current === level ? overdueNow : hours * (current - 1),
        dueAt,
        policyId: policy?.id ?? null,
        escalateToRole: roles[0],
        recipientRoles: roles,
        dedupeKey,
        residentUserId: item.userId,
      });
    }
  }

  return planned;
}

/**
 * The window a stage runs on right now, from the active policies.
 */
export async function resolveStageWindow(
  client: Prisma.TransactionClient,
  scope: SlaScope
): Promise<{ policy: SlaPolicyLike | null; hours: number }> {
  const policies = await client.slaPolicy.findMany({
    where: { isActive: true, stage: scope.stage },
  });
  return resolveSlaWindow(policies, scope);
}

/**
 * Re-arms the SLA clock for the stage a case just entered: stores the resolved
 * policy on the case and the due instant the escalation job will compare
 * against. Called on submission and on every status change, so the clock always
 * belongs to the stage the case is actually in.
 *
 * Returns null for stages where nothing is owed (RESOLVED, CLOSED): the case
 * stops being scanned, and its last due date stays on the row as the record of
 * when it was committed.
 */
export async function armCaseStageClock(
  tx: Prisma.TransactionClient,
  input: {
    concernId: number;
    status: string;
    from?: Date;
    /** Pass the values already in hand to save a query. */
    typeId?: number | null;
    priorityLevel?: string | null;
  }
): Promise<{ policyId: number | null; hours: number; dueAt: Date } | null> {
  if (!isSlaOpenStage(input.status)) return null;

  let typeId = input.typeId;
  let priorityLevel = input.priorityLevel;
  if (typeId === undefined || priorityLevel === undefined) {
    const row = await tx.concern.findUnique({
      where: { id: input.concernId },
      select: { typeId: true, priorityLevel: true },
    });
    typeId = row?.typeId ?? null;
    priorityLevel = row?.priorityLevel ?? null;
  }

  const { policy, hours } = await resolveStageWindow(tx, {
    stage: input.status,
    typeId: typeId ?? null,
    priorityLevel: priorityLevel ?? null,
  });
  const dueAt = slaDueAt(input.from ?? new Date(), hours);

  await tx.concern.update({
    where: { id: input.concernId },
    data: { slaDueAt: dueAt, slaPolicyId: policy?.id ?? null },
  });

  return { policyId: policy?.id ?? null, hours, dueAt };
}

export type SlaRunResult = {
  cronRunId: number | null;
  status: "SUCCESS" | "FAILED";
  scanned: number;
  escalated: number;
  alreadyRecorded: number;
  cases: Array<{
    concernId: number;
    caseNumber: string;
    stage: string;
    level: number;
    hoursOverdue: number;
    escalatedToRole: string;
  }>;
  error: string | null;
};

async function loadRecipients(
  tx: Prisma.TransactionClient,
  roles: readonly string[]
): Promise<Array<{ id: number; roleKey: string }>> {
  if (roles.length === 0) return [];
  const users = await tx.user.findMany({
    where: { isActive: true, role: { key: { in: [...roles] } } },
    select: { id: true, role: { select: { key: true } } },
  });
  return users.map((user) => ({ id: user.id, roleKey: user.role.key }));
}

/**
 * Writes one escalation (plus its history entries, notifications and audit row)
 * inside the caller's transaction. Returns false when the dedupe key is already
 * taken — the job may run concurrently with itself.
 */
async function escalateCase(
  tx: Prisma.TransactionClient,
  plan: PlannedEscalation,
  now: Date
): Promise<boolean> {
  const existing = await tx.caseEscalation.findUnique({
    where: { dedupeKey: plan.dedupeKey },
    select: { id: true },
  });
  if (existing) return false;

  const recipients = await loadRecipients(tx, plan.recipientRoles);
  const primary = recipients.filter((user) => user.roleKey === plan.escalateToRole);

  const escalation = await tx.caseEscalation.create({
    data: {
      concernId: plan.concernId,
      policyId: plan.policyId,
      stage: plan.stage,
      level: plan.level,
      hoursOverdue: plan.hoursOverdue,
      escalatedToRole: plan.escalateToRole,
      escalatedToUserId: primary.length === 1 ? primary[0].id : null,
      dedupeKey: plan.dedupeKey,
      createdAt: now,
    },
  });

  await tx.concern.update({
    where: { id: plan.concernId },
    data: {
      slaPolicyId: plan.policyId ?? undefined,
      // First breach time only: later levels keep the original instant.
      slaBreachedAt: plan.level === 1 ? now : undefined,
    },
  });

  // The resident has been waiting: tell them once, at level 1.
  if (plan.level === 1) {
    await tx.caseStatusHistory.create({
      data: {
        concernId: plan.concernId,
        entryType: HISTORY_ENTRY_SLA_BREACH,
        fromStatus: null,
        toStatus: null,
        remarks: `The ${plan.hours}-hour service window for ${plan.stage.replaceAll(
          "_",
          " "
        ).toLowerCase()} has passed. The case is still active and is being monitored.`,
        visibility: "RESIDENT_VISIBLE",
        actorRole: "SYSTEM",
        createdAt: now,
      },
    });
  }

  await tx.caseStatusHistory.create({
    data: {
      concernId: plan.concernId,
      entryType: "ESCALATION",
      fromStatus: null,
      toStatus: null,
      remarks: `${escalationLevelLabel(plan.level)}: ${plan.caseNumber} has been in ${
        plan.stage
      } for ${plan.hoursOverdue}h past its ${plan.hours}-hour window. Escalated to ${
        plan.recipientRoles.join(", ")
      }.`,
      visibility: "INTERNAL",
      metadataJson: JSON.stringify({
        escalationId: escalation.id,
        level: plan.level,
        hours: plan.hours,
        hoursOverdue: plan.hoursOverdue,
        policyId: plan.policyId,
        roles: plan.recipientRoles,
        stagedEnteredAt: plan.dueAt.toISOString(),
      }),
      actorRole: "SYSTEM",
      createdAt: now,
    },
  });

  const notified = new Set<number>();
  for (const recipient of recipients) {
    notified.add(recipient.id);
    await notifySlaBreached(tx, {
      userId: recipient.id,
      concernId: plan.concernId,
      title: "Case SLA breached",
      message: `${plan.caseNumber} has been in ${plan.stage} for ${plan.hoursOverdue}h past its ${plan.hours}-hour window (${escalationLevelLabel(plan.level)}).`,
    });
  }

  if (plan.level === 1 && !notified.has(plan.residentUserId)) {
    await notifySlaBreached(tx, {
      userId: plan.residentUserId,
      concernId: plan.concernId,
      title: "Your concern is taking longer than expected",
      message: `Concern ${plan.caseNumber} has passed its service deadline. It remains active and is being monitored.`,
    });
  }

  await appendAuditEntry(tx, {
    action: "sla.escalation.created",
    resourceType: "Concern",
    resourceId: String(plan.concernId),
    description: `${escalationLevelLabel(plan.level)} for ${plan.caseNumber} (${plan.stage}), ${plan.hoursOverdue}h overdue, escalated to ${plan.recipientRoles.join(", ")}.`,
    actorRole: "SYSTEM",
    createdAt: now,
  });

  return true;
}

/**
 * The cron entry point: scans open cases, writes the missing escalations and
 * records the run in `CronRun` so "did the job run, and what did it do?" is
 * answerable from the UI instead of from logs. Never throws.
 */
export async function runSlaEscalations(input: {
  triggeredBy: SlaRunTrigger;
  actorId?: number | null;
  now?: Date;
  limit?: number;
  maxLevel?: number;
}): Promise<SlaRunResult> {
  const now = input.now ?? new Date();
  const limit = input.limit ?? SLA_SCAN_LIMIT;

  const cronRun = await db.cronRun.create({
    data: {
      job: SLA_JOB,
      status: "RUNNING",
      triggerSource: input.triggeredBy,
      actorId: input.actorId ?? null,
      startedAt: now,
    },
  });

  try {
    const [policies, cases] = await Promise.all([
      db.slaPolicy.findMany({ where: { isActive: true } }),
      db.concern.findMany({
        where: { status: { in: [...SLA_OPEN_STAGES] }, duplicateOfId: null },
        orderBy: { stageEnteredAt: "asc" },
        take: limit,
        select: {
          id: true,
          caseNumber: true,
          status: true,
          stageEnteredAt: true,
          slaDueAt: true,
          typeId: true,
          priorityLevel: true,
          userId: true,
        },
      }),
    ]);

    const recorded = cases.length
      ? await db.caseEscalation.findMany({
          where: { concernId: { in: cases.map((row) => row.id) } },
          select: { dedupeKey: true },
        })
      : [];
    const existingKeys = new Set(recorded.map((row) => row.dedupeKey));

    const planned = planEscalations({
      cases: cases.map((row) => ({
        id: row.id,
        caseNumber: row.caseNumber,
        status: row.status,
        stageEnteredAt: row.stageEnteredAt,
        slaDueAt: row.slaDueAt,
        typeId: row.typeId,
        priorityLevel: row.priorityLevel,
        userId: row.userId,
      })),
      policies,
      now,
      existingKeys,
      maxLevel: input.maxLevel,
    });

    const written: SlaRunResult["cases"] = [];
    for (const plan of planned) {
      try {
        const created = await db.$transaction((tx) => escalateCase(tx, plan, now));
        if (created) {
          written.push({
            concernId: plan.concernId,
            caseNumber: plan.caseNumber,
            stage: plan.stage,
            level: plan.level,
            hoursOverdue: plan.hoursOverdue,
            escalatedToRole: plan.escalateToRole,
          });
        }
      } catch (error) {
        console.error(
          `[sla] could not escalate ${plan.caseNumber} (level ${plan.level}):`,
          error
        );
      }
    }

    await db.cronRun.update({
      where: { id: cronRun.id },
      data: {
        status: "SUCCESS",
        finishedAt: new Date(),
        processed: written.length,
        summary: JSON.stringify({
          scanned: cases.length,
          escalated: written.length,
          alreadyRecorded: planned.length - written.length,
          limit,
          limitReached: cases.length >= limit,
        }),
      },
    });

    await appendAuditEntryStandalone({
      action: "sla.escalations.run",
      resourceType: "CronRun",
      resourceId: String(cronRun.id),
      description: `${written.length} escalation(s) written from ${cases.length} open case(s).`,
      actorRole: input.triggeredBy === "CRON" ? "CRON" : "ADMIN",
      userId: input.actorId ?? null,
    });

    return {
      cronRunId: cronRun.id,
      status: "SUCCESS",
      scanned: cases.length,
      escalated: written.length,
      alreadyRecorded: planned.length - written.length,
      cases: written,
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.cronRun
      .update({
        where: { id: cronRun.id },
        data: { status: "FAILED", finishedAt: new Date(), error: message },
      })
      .catch(() => undefined);
    console.error("[sla] escalation run failed:", error);
    return {
      cronRunId: cronRun.id,
      status: "FAILED",
      scanned: 0,
      escalated: 0,
      alreadyRecorded: 0,
      cases: [],
      error: message,
    };
  }
}

export type EscalationQueueRow = {
  id: number;
  concernId: number;
  caseNumber: string;
  caseTitle: string;
  concernStatus: string;
  assignedOfficeName: string | null;
  stage: string;
  level: number;
  hoursOverdue: number;
  escalatedToRole: string;
  policyId: number | null;
  policyName: string | null;
  acknowledgedAt: Date | null;
  acknowledgedByName: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
};

function nameOf(user: { firstName: string; lastName: string } | null): string | null {
  return user ? `${user.firstName} ${user.lastName}`.trim() : null;
}

/** The Captain's queue (and the admin's view of every escalation). */
export async function listEscalationQueue(filters: {
  status?: "OPEN" | "ACKNOWLEDGED" | "RESOLVED" | "ALL";
  roleKeys?: readonly string[];
  concernId?: number;
  limit?: number;
  offset?: number;
} = {}): Promise<{ rows: EscalationQueueRow[]; total: number; counts: EscalationCounts }> {
  const where: Prisma.CaseEscalationWhereInput = {};
  if (filters.concernId) where.concernId = filters.concernId;
  if (filters.roleKeys && filters.roleKeys.length > 0) {
    where.escalatedToRole = { in: [...filters.roleKeys] };
  }
  if (filters.status === "OPEN") {
    where.resolvedAt = null;
    where.acknowledgedAt = null;
  } else if (filters.status === "ACKNOWLEDGED") {
    where.resolvedAt = null;
    where.acknowledgedAt = { not: null };
  } else if (filters.status === "RESOLVED") {
    where.resolvedAt = { not: null };
  }

  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const offset = Math.max(filters.offset ?? 0, 0);

  const [rows, total, scoped] = await Promise.all([
    db.caseEscalation.findMany({
      where,
      orderBy: [{ resolvedAt: "asc" }, { createdAt: "desc" }],
      skip: offset,
      take: limit,
      select: {
        id: true,
        concernId: true,
        stage: true,
        level: true,
        hoursOverdue: true,
        escalatedToRole: true,
        policyId: true,
        acknowledgedAt: true,
        resolvedAt: true,
        createdAt: true,
        policy: { select: { name: true } },
        acknowledgedBy: { select: { firstName: true, lastName: true } },
        concern: {
          select: {
            caseNumber: true,
            title: true,
            status: true,
            assignedOffice: { select: { name: true } },
          },
        },
      },
    }),
    db.caseEscalation.count({ where }),
    // Counts always describe the viewer's own scope, whatever the filter is.
    db.caseEscalation.findMany({
      where:
        filters.roleKeys && filters.roleKeys.length > 0
          ? { escalatedToRole: { in: [...filters.roleKeys] } }
          : {},
      select: { level: true, acknowledgedAt: true, resolvedAt: true },
    }),
  ]);

  return {
    rows: rows.map((row) => ({
      id: row.id,
      concernId: row.concernId,
      caseNumber: row.concern.caseNumber,
      caseTitle: row.concern.title,
      concernStatus: row.concern.status,
      assignedOfficeName: row.concern.assignedOffice?.name ?? null,
      stage: row.stage,
      level: row.level,
      hoursOverdue: row.hoursOverdue,
      escalatedToRole: row.escalatedToRole,
      policyId: row.policyId,
      policyName: row.policy?.name ?? null,
      acknowledgedAt: row.acknowledgedAt,
      acknowledgedByName: nameOf(row.acknowledgedBy),
      resolvedAt: row.resolvedAt,
      createdAt: row.createdAt,
    })),
    total,
    counts: summarizeEscalations(scoped),
  };
}

/**
 * Acknowledging says "seen, and someone owns it now"; resolving says "the case
 * is out of the woods". Both are audited and both write a case-history entry so
 * the case page tells the same story as the queue.
 */
export async function actOnEscalation(input: {
  id: number;
  actorId: number;
  actorRoleKey: string;
  action: "ACKNOWLEDGE" | "RESOLVE";
  note?: string | null;
}): Promise<EscalationQueueRow> {
  const escalation = await db.caseEscalation.findUnique({
    where: { id: input.id },
    select: { id: true, concernId: true, stage: true, level: true, acknowledgedAt: true, resolvedAt: true },
  });
  if (!escalation) throw new Error("not-found");
  if (escalation.resolvedAt) throw new Error("already-resolved");

  const now = new Date();
  const row = await db.$transaction(async (tx) => {
    const updated = await tx.caseEscalation.update({
      where: { id: input.id },
      data:
        input.action === "RESOLVE"
          ? {
              resolvedAt: now,
              acknowledgedAt: escalation.acknowledgedAt ?? now,
              acknowledgedById: escalation.acknowledgedAt ? undefined : input.actorId,
            }
          : {
              acknowledgedAt: escalation.acknowledgedAt ?? now,
              acknowledgedById: escalation.acknowledgedAt ? undefined : input.actorId,
            },
    });

    await tx.caseStatusHistory.create({
      data: {
        concernId: escalation.concernId,
        entryType: "ESCALATION",
        fromStatus: null,
        toStatus: null,
        remarks:
          input.action === "RESOLVE"
            ? `Escalation (level ${escalation.level}) resolved by the ${input.actorRoleKey.toLowerCase()}.${
                input.note ? ` Note: ${input.note}` : ""
              }`
            : `Escalation (level ${escalation.level}) acknowledged by the ${input.actorRoleKey.toLowerCase()}.${
                input.note ? ` Note: ${input.note}` : ""
              }`,
        visibility: "INTERNAL",
        metadataJson: JSON.stringify({ escalationId: input.id, action: input.action }),
        actorId: input.actorId,
        actorRole: input.actorRoleKey,
        createdAt: now,
      },
    });

    await appendAuditEntry(tx, {
      action:
        input.action === "RESOLVE" ? "sla.escalation.resolved" : "sla.escalation.acknowledged",
      resourceType: "CaseEscalation",
      resourceId: String(input.id),
      description: `Level ${escalation.level} escalation on case #${escalation.concernId} ${
        input.action === "RESOLVE" ? "resolved" : "acknowledged"
      } by the ${input.actorRoleKey.toLowerCase()}.${input.note ? ` Note: ${input.note}` : ""}`,
      userId: input.actorId,
      actorRole: input.actorRoleKey,
      createdAt: now,
    });

    return updated;
  });

  return {
    id: row.id,
    concernId: row.concernId,
    caseNumber: "",
    caseTitle: "",
    concernStatus: "",
    assignedOfficeName: null,
    stage: row.stage,
    level: row.level,
    hoursOverdue: row.hoursOverdue,
    escalatedToRole: row.escalatedToRole,
    policyId: row.policyId,
    policyName: null,
    acknowledgedAt: row.acknowledgedAt,
    acknowledgedByName: null,
    resolvedAt: row.resolvedAt,
    createdAt: row.createdAt,
  };
}

/**
 * Called whenever a case moves: once it is resolved or closed, the open
 * escalations for it are closed too, so the queue cannot keep showing work that
 * has been done.
 */
export async function resolveEscalationsForCase(
  tx: Prisma.TransactionClient,
  concernId: number,
  when: Date = new Date()
): Promise<number> {
  const result = await tx.caseEscalation.updateMany({
    where: { concernId, resolvedAt: null },
    data: { resolvedAt: when },
  });
  return result.count;
}

export type SlaPolicyRow = SlaPolicyLike & {
  typeName: string | null;
  createdAt: Date;
  updatedAt: Date;
  openEscalations: number;
};

export async function listSlaPolicies(): Promise<SlaPolicyRow[]> {
  const rows = await db.slaPolicy.findMany({
    orderBy: [{ stage: "asc" }, { id: "asc" }],
    select: {
      id: true,
      key: true,
      name: true,
      stage: true,
      typeId: true,
      priorityLevel: true,
      hours: true,
      escalateToRole: true,
      notifyRoles: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      type: { select: { name: true } },
      _count: { select: { escalations: { where: { resolvedAt: null } } } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    key: row.key,
    name: row.name,
    stage: row.stage,
    typeId: row.typeId,
    priorityLevel: row.priorityLevel,
    hours: row.hours,
    escalateToRole: row.escalateToRole,
    notifyRoles: row.notifyRoles,
    isActive: row.isActive,
    typeName: row.type?.name ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    openEscalations: row._count.escalations,
  }));
}

export async function upsertSlaPolicy(input: {
  id?: number | null;
  key: string;
  name: string;
  stage: string;
  typeId?: number | null;
  priorityLevel?: string | null;
  hours: number;
  escalateToRole: string;
  notifyRoles?: string | null;
  isActive: boolean;
  actorId: number;
  actorRoleKey: string;
  meta?: { ip: string | null; userAgent: string | null };
}): Promise<{ id: number; key: string }> {
  const data = {
    key: input.key,
    name: input.name,
    stage: input.stage,
    typeId: input.typeId ?? null,
    priorityLevel: input.priorityLevel?.trim() ? input.priorityLevel.trim().toUpperCase() : null,
    hours: input.hours,
    escalateToRole: input.escalateToRole.toUpperCase(),
    notifyRoles: input.notifyRoles?.trim() ? input.notifyRoles.trim().toUpperCase() : null,
    isActive: input.isActive,
  };

  const row = await db.$transaction(async (tx) => {
    const saved = input.id
      ? await tx.slaPolicy.update({ where: { id: input.id }, data })
      : await tx.slaPolicy.create({ data: { ...data, createdById: input.actorId } });

    await appendAuditEntry(tx, {
      action: input.id ? "sla.policy.updated" : "sla.policy.created",
      resourceType: "SlaPolicy",
      resourceId: String(saved.id),
      description: `${saved.name} (${saved.stage}, ${saved.hours}h, escalates to ${saved.escalateToRole})`,
      userId: input.actorId,
      actorRole: input.actorRoleKey,
      ip: input.meta?.ip ?? null,
      userAgent: input.meta?.userAgent ?? null,
    });

    return saved;
  });

  return { id: row.id, key: row.key };
}

export async function setSlaPolicyActive(input: {
  id: number;
  isActive: boolean;
  actorId: number;
  actorRoleKey: string;
  meta?: { ip: string | null; userAgent: string | null };
}): Promise<{ id: number; isActive: boolean }> {
  const row = await db.$transaction(async (tx) => {
    const saved = await tx.slaPolicy.update({
      where: { id: input.id },
      data: { isActive: input.isActive },
    });
    await appendAuditEntry(tx, {
      action: input.isActive ? "sla.policy.activated" : "sla.policy.deactivated",
      resourceType: "SlaPolicy",
      resourceId: String(saved.id),
      description: `${saved.name} ${input.isActive ? "activated" : "deactivated"}.`,
      userId: input.actorId,
      actorRole: input.actorRoleKey,
      ip: input.meta?.ip ?? null,
      userAgent: input.meta?.userAgent ?? null,
    });
    return saved;
  });
  return { id: row.id, isActive: row.isActive };
}

export type SlaOverview = {
  counts: EscalationCounts;
  openCases: number;
  breachingCases: number;
  oldestDueAt: Date | null;
  policies: number;
  activePolicies: number;
  lastRuns: Array<{
    id: number;
    status: string;
    startedAt: Date;
    finishedAt: Date | null;
    processed: number;
    summary: string | null;
    error: string | null;
    triggerSource: string;
  }>;
};

export async function slaOverview(): Promise<SlaOverview> {
  const now = new Date();
  const [escalations, openCases, breachingCases, oldest, policies, activePolicies, lastRuns] =
    await Promise.all([
      db.caseEscalation.findMany({
        select: { level: true, acknowledgedAt: true, resolvedAt: true },
      }),
      db.concern.count({
        where: { status: { in: [...SLA_OPEN_STAGES] }, duplicateOfId: null },
      }),
      db.concern.count({
        where: {
          status: { in: [...SLA_OPEN_STAGES] },
          duplicateOfId: null,
          OR: [{ slaBreachedAt: { not: null } }, { slaDueAt: { lt: now } }],
        },
      }),
      db.concern.findFirst({
        where: { status: { in: [...SLA_OPEN_STAGES] }, slaDueAt: { not: null } },
        orderBy: { slaDueAt: "asc" },
        select: { slaDueAt: true },
      }),
      db.slaPolicy.count(),
      db.slaPolicy.count({ where: { isActive: true } }),
      db.cronRun.findMany({
        where: { job: SLA_JOB },
        orderBy: { id: "desc" },
        take: 8,
        select: {
          id: true,
          status: true,
          startedAt: true,
          finishedAt: true,
          processed: true,
          summary: true,
          error: true,
          triggerSource: true,
        },
      }),
    ]);

  return {
    counts: summarizeEscalations(escalations),
    openCases,
    breachingCases,
    oldestDueAt: oldest?.slaDueAt ?? null,
    policies,
    activePolicies,
    lastRuns,
  };
}

/** Escalations attached to one case, for the case page. */
export async function escalationsForCase(concernId: number): Promise<EscalationQueueRow[]> {
  const { rows } = await listEscalationQueue({ concernId, status: "ALL", limit: 50 });
  return rows;
}

/** Levels that may still fire for a case, for the "what happens next" hint. */
export function remainingEscalationLevels(level: number, maxLevel = SLA_MAX_ESCALATION_LEVEL): number {
  return Math.max(maxLevel - level, 0);
}
