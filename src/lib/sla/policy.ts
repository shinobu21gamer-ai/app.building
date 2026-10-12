// SLA rules — pure functions, no database.
//
// The barangay's promise is a 48-hour window per open stage. A window can be
// narrowed (or widened) by an `SlaPolicy` row matching the case's stage, and
// optionally its service type and priority; the most specific active policy
// wins, and the resolved policy id is stored on the case so an escalation can
// be explained afterwards ("which rule was this case running against?").
//
// The clock is `Concern.stageEnteredAt` — not `updatedAt`, which any edit would
// move, and not `createdAt`, which would punish a case that spent two weeks in
// AWAITING_BUDGET after being assessed quickly.

/** Window used when no active policy matches. */
export const SLA_DEFAULT_HOURS = 48;

/** Escalation stops growing after this level. */
export const SLA_MAX_ESCALATION_LEVEL = 3;

/** Role that receives an escalation when the policy does not say otherwise. */
export const SLA_DEFAULT_ESCALATION_ROLE = "CAPTAIN";

/**
 * Statuses where the clock is running. RESOLVED and CLOSED are excluded: a case
 * waiting on the resident to confirm the fix, or a case that is closed, is not
 * the office being late.
 */
export const SLA_OPEN_STAGES = [
  "SUBMITTED",
  "ASSIGNED",
  "UNDER_ASSESSMENT",
  "AWAITING_BUDGET",
  "IN_PROGRESS",
] as const;

export type SlaOpenStage = (typeof SLA_OPEN_STAGES)[number];

export type SlaPolicyLike = {
  id: number;
  key: string;
  name: string;
  stage: string;
  typeId: number | null;
  priorityLevel: string | null;
  hours: number;
  escalateToRole: string;
  notifyRoles: string | null;
  isActive: boolean;
};

export type SlaScope = {
  stage: string;
  typeId?: number | null;
  priorityLevel?: string | null;
};

export function isSlaOpenStage(stage: string): stage is SlaOpenStage {
  return (SLA_OPEN_STAGES as readonly string[]).includes(stage);
}

/**
 * How specific a policy is for a scope, or `-1` when it does not apply at all.
 * A policy that names a type or a priority only applies to cases that have it.
 */
export function policySpecificity(
  policy: Pick<SlaPolicyLike, "stage" | "typeId" | "priorityLevel" | "isActive">,
  scope: SlaScope
): number {
  if (!policy.isActive) return -1;
  if (policy.stage !== scope.stage) return -1;

  if (policy.typeId !== null) {
    if (scope.typeId === null || scope.typeId === undefined) return -1;
    if (policy.typeId !== scope.typeId) return -1;
  }

  if (policy.priorityLevel !== null) {
    if (!scope.priorityLevel) return -1;
    if (policy.priorityLevel !== scope.priorityLevel) return -1;
  }

  return (policy.typeId !== null ? 2 : 0) + (policy.priorityLevel !== null ? 1 : 0);
}

/**
 * The active policy that governs a scope: most specific wins, ties broken by
 * the lowest id so the answer is stable.
 */
export function resolveSlaPolicy<T extends SlaPolicyLike>(
  policies: readonly T[],
  scope: SlaScope
): T | null {
  let best: T | null = null;
  let bestScore = -1;

  for (const policy of policies) {
    const score = policySpecificity(policy, scope);
    if (score < 0) continue;
    if (score > bestScore || (score === bestScore && best !== null && policy.id < best.id)) {
      best = policy;
      bestScore = score;
    }
  }

  return best;
}

/** The window a scope runs against: the resolved policy's hours, or 48. */
export function resolveSlaWindow(
  policies: readonly SlaPolicyLike[],
  scope: SlaScope
): { policy: SlaPolicyLike | null; hours: number } {
  const policy = resolveSlaPolicy(policies, scope);
  const hours = policy && Number.isFinite(policy.hours) && policy.hours > 0
    ? Math.round(policy.hours)
    : SLA_DEFAULT_HOURS;
  return { policy, hours };
}

export function slaDueAt(from: Date, hours: number): Date {
  const window = Number.isFinite(hours) && hours > 0 ? hours : SLA_DEFAULT_HOURS;
  return new Date(from.getTime() + window * 60 * 60 * 1000);
}

/** Whole hours between two instants, never negative. */
export function hoursBetween(from: Date, to: Date): number {
  const diff = to.getTime() - from.getTime();
  return diff <= 0 ? 0 : Math.floor(diff / (60 * 60 * 1000));
}

/**
 * Escalation level for an overdue case.
 *
 *   0 = not overdue · 1 = the deadline was missed · 2 = one full window later
 *   (2×) · 3 = two full windows later (3×), and it stops there.
 */
export function escalationLevelFor(input: {
  dueAt: Date;
  now: Date;
  hours: number;
  maxLevel?: number;
}): number {
  const maxLevel = input.maxLevel ?? SLA_MAX_ESCALATION_LEVEL;
  if (input.now.getTime() < input.dueAt.getTime()) return 0;

  const windowMs = (Number.isFinite(input.hours) && input.hours > 0 ? input.hours : SLA_DEFAULT_HOURS) * 60 * 60 * 1000;
  const overdueMs = input.now.getTime() - input.dueAt.getTime();
  const fullWindows = Math.floor(overdueMs / windowMs);
  return Math.min(1 + fullWindows, maxLevel);
}

/** The idempotency key stored on `CaseEscalation.dedupeKey`. */
export function escalationDedupeKey(
  concernId: number,
  stage: string,
  level: number
): string {
  return `${concernId}:${stage}:${level}`;
}

/** Roles a policy notifies in addition to `escalateToRole`. */
export function parseNotifyRoles(policy: Pick<SlaPolicyLike, "notifyRoles"> | null): string[] {
  if (!policy?.notifyRoles) return [];
  return policy.notifyRoles
    .split(",")
    .map((role) => role.trim().toUpperCase())
    .filter((role) => role.length > 0)
    .filter((role, index, all) => all.indexOf(role) === index);
}

/** Every role that should receive an escalation for a policy. */
export function recipientRoles(
  policy: Pick<SlaPolicyLike, "escalateToRole" | "notifyRoles"> | null
): string[] {
  const primary = policy?.escalateToRole?.trim().toUpperCase() || SLA_DEFAULT_ESCALATION_ROLE;
  return [primary, ...parseNotifyRoles(policy).filter((role) => role !== primary)];
}

export function escalationLevelLabel(level: number): string {
  if (level <= 1) return "Level 1 — deadline missed";
  return `Level ${level} — ${level}× the window`;
}

export type EscalationCounts = {
  total: number;
  open: number;
  acknowledged: number;
  resolved: number;
  byLevel: Record<number, number>;
};

/** Counts for the desk headers. Rows are the raw `CaseEscalation` shape subset. */
export function summarizeEscalations(
  rows: readonly { level: number; acknowledgedAt: Date | null; resolvedAt: Date | null }[]
): EscalationCounts {
  const counts: EscalationCounts = {
    total: rows.length,
    open: 0,
    acknowledged: 0,
    resolved: 0,
    byLevel: {},
  };
  for (const row of rows) {
    counts.byLevel[row.level] = (counts.byLevel[row.level] ?? 0) + 1;
    if (row.resolvedAt) counts.resolved += 1;
    else if (row.acknowledgedAt) counts.acknowledged += 1;
    else counts.open += 1;
  }
  return counts;
}
