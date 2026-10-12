import { recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { summarizeRetention } from "@/lib/reports/privacy";
import { deleteConcernImage } from "@/lib/uploads";

/**
 * The retention sweep (RA 10173 §11 "storage limitation", README decision 9).
 *
 * The eight `RetentionPolicy` rows seeded by migration
 * `20261012000000_revamp_core_schema` are the contract: a policy row says how
 * long a data category may live, and this module is the only code allowed to
 * enforce it. Every run is recorded twice — a `RetentionRun` per policy (what
 * was scanned and what changed) and a `CronRun` for the sweep as a whole — so
 * "when did we last destroy something, and what was it" has an answer that does
 * not depend on log retention.
 *
 * Three rules shape the handlers below:
 *
 * 1. **Nothing destroys evidence.** `ARCHIVE` policies (the access log, the
 *    audit trail, DSR records) are never deleted: the audit trail is
 *    hash-chained, so deleting rows would make the chain unverifiable, and the
 *    other two are the proof that the barangay answered residents at all. They
 *    are swept, counted and reported, and their rows stay put under a legal
 *    obligation — which is itself a lawful basis to keep them.
 * 2. **A verdict outlives the document it rested on.** Identity verification
 *    deletes the ID number and the pictures after a year but keeps the
 *    VERIFIED/REJECTED decision, because the assistance gate needs to know the
 *    resident was verified, not what their ID number was.
 * 3. **An unknown policy is a skip, not a guess.** A key with no handler is
 *    reported as SKIPPED in the run record rather than silently doing nothing,
 *    so a new policy row cannot masquerade as enforcement.
 */

export type RetentionAction = "DELETE" | "ANONYMIZE" | "ARCHIVE";

export const RETENTION_ACTIONS: readonly RetentionAction[] = [
  "DELETE",
  "ANONYMIZE",
  "ARCHIVE",
];

export const RETENTION_JOB = "RETENTION";

/** One sweep a day at most, even though the cron fires hourly. */
export const RETENTION_MIN_INTERVAL_HOURS = 20;

/** Per policy, per run: enough for a barangay, bounded enough for a cron. */
export const RETENTION_MAX_ROWS = 5000;

/** Written into a case description that has outlived its retention period. */
export const ANONYMISED_CASE_NOTE =
  "[anonymised: personal details removed under the retention policy]";

/**
 * The seeded policy keys, duplicated here only so the drift test can compare
 * this list against the migration. `RetentionPolicy.key` is the join between
 * the two, and this constant is the mirror.
 */
export const RETENTION_POLICY_KEYS = [
  "uploads.concern_images",
  "pii.id_verification",
  "pii.pii_access_log",
  "case.records",
  "notification.inbox",
  "audit.entries",
  "dsr.records",
  "session.revoked_tokens",
] as const;

export type RetentionPolicyKey = (typeof RETENTION_POLICY_KEYS)[number];

/**
 * A data-subject request that has not been decided yet is a **legal hold**.
 *
 * The resident is mid-claim — an access, rectification or erasure request is
 * being handled — and the rows the sweep would delete or overwrite are exactly
 * the evidence that request rests on. Deleting them while the request is open
 * would make the barangay unable to answer it, so the sweep skips those
 * residents' rows and reports how many it left alone.
 *
 * The hold is deliberately narrow:
 *   * it covers the policies that destroy or overwrite personal data
 *     (`HOLD_SCOPED_POLICY_KEYS`), not the archival ones — those delete nothing
 *     to begin with;
 *   * it is scoped to the requester, not the barangay: everyone else's rows are
 *     still swept on schedule;
 *   * it lifts by itself when the request is COMPLETED or REJECTED, because it is
 *     derived from the request rows and never stored.
 */
export const OPEN_DSR_STATUSES = ["RECEIVED", "IN_REVIEW"] as const;

/** Policies a hold protects: the ones whose handlers delete or overwrite. */
export const HOLD_SCOPED_POLICY_KEYS = [
  "uploads.concern_images",
  "pii.id_verification",
  "case.records",
  "notification.inbox",
] as const;

export function isHoldScoped(policyKey: string): boolean {
  return (HOLD_SCOPED_POLICY_KEYS as readonly string[]).includes(policyKey);
}

/**
 * The fragment that keeps held residents out of a sweep. Every hold-scoped
 * category is keyed by `userId` (concerns, verifications and notifications all
 * carry one), so one fragment fits all four; anything not hold-scoped gets no
 * fragment at all rather than an empty filter.
 */
export function holdFilter(
  policyKey: string,
  heldUserIds: readonly number[]
): { userId?: { notIn: number[] } } {
  if (heldUserIds.length === 0 || !isHoldScoped(policyKey)) return {};
  return { userId: { notIn: [...heldUserIds] } };
}

/** Residents with an open data-subject request, i.e. the ones on hold. */
export async function heldResidentIds(): Promise<number[]> {
  const rows = await db.dataSubjectRequest.findMany({
    where: { status: { in: [...OPEN_DSR_STATUSES] } },
    select: { userId: true },
    distinct: ["userId"],
  });
  return rows.map((row) => row.userId);
}

export interface RetentionPolicyLike {
  id: number;
  key: string;
  dataCategory: string;
  retentionDays: number;
  action: string;
  isActive: boolean;
  lastRunAt: Date | null;
}

export interface RetentionSkip {
  key: string;
  reason: "INACTIVE" | "RECENTLY_RUN" | "NOT_SELECTED";
  lastRunAt: Date | null;
}

export interface RetentionPlan {
  due: RetentionPolicyLike[];
  skipped: RetentionSkip[];
  now: Date;
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** The instant before which a policy's data is out of time, i.e. `now - days`. */
export function cutoffFor(policy: RetentionPolicyLike, now: Date): Date {
  return new Date(now.getTime() - policy.retentionDays * DAY_MS);
}

/**
 * Which policies this sweep should execute.
 *
 * `keys` narrows the sweep to specific policies (used by an admin re-running a
 * single policy after fixing something); `force` ignores the once-a-day guard,
 * which is why the cron route only honours it for the secret-bearing caller.
 */
export function planRetention(
  policies: readonly RetentionPolicyLike[],
  now: Date,
  options: { force?: boolean; keys?: readonly string[] } = {}
): RetentionPlan {
  const due: RetentionPolicyLike[] = [];
  const skipped: RetentionSkip[] = [];

  for (const policy of policies) {
    if (!policy.isActive) {
      skipped.push({ key: policy.key, reason: "INACTIVE", lastRunAt: policy.lastRunAt });
      continue;
    }
    if (options.keys && options.keys.length > 0 && !options.keys.includes(policy.key)) {
      skipped.push({
        key: policy.key,
        reason: "NOT_SELECTED",
        lastRunAt: policy.lastRunAt,
      });
      continue;
    }
    if (
      !options.force &&
      policy.lastRunAt !== null &&
      now.getTime() - policy.lastRunAt.getTime() <
        RETENTION_MIN_INTERVAL_HOURS * HOUR_MS
    ) {
      skipped.push({
        key: policy.key,
        reason: "RECENTLY_RUN",
        lastRunAt: policy.lastRunAt,
      });
      continue;
    }
    due.push(policy);
  }

  return { due, skipped, now };
}

/* ---------------------------------------------------------------- handlers */

export interface RetentionHandlerResult {
  scanned: number;
  affected: number;
  /** Rows the handler would have swept but left alone because of a hold. */
  held: number;
  summary: string;
}

export interface RetentionContext {
  policy: RetentionPolicyLike;
  cutoff: Date;
  now: Date;
  /** Residents with an open data-subject request (see `heldResidentIds`). */
  heldUserIds: readonly number[];
}

type RetentionHandler = (context: RetentionContext) => Promise<RetentionHandlerResult>;

function plural(count: number, noun: string): string {
  return `${count.toString()} ${noun}${count === 1 ? "" : "s"}`;
}

const uploadsConcernImages: RetentionHandler = async ({
  cutoff,
  policy,
  heldUserIds,
}) => {
  const where = {
    status: "CLOSED",
    closedAt: { not: null, lt: cutoff },
    imageUrl: { not: null },
  };
  const candidates = await db.concern.findMany({
    where: { ...where, ...holdFilter(policy.key, heldUserIds) },
    select: { id: true, imageUrl: true },
    take: RETENTION_MAX_ROWS,
  });
  const held =
    heldUserIds.length === 0
      ? 0
      : await db.concern.count({
          where: { ...where, userId: { in: [...heldUserIds] } },
        });

  let affected = 0;
  for (const concern of candidates) {
    const filename = concern.imageUrl?.split("/").pop() ?? null;
    await deleteConcernImage(filename);
    await db.concern.update({
      where: { id: concern.id },
      data: { imageUrl: null },
    });
    affected += 1;
  }

  return {
    scanned: candidates.length,
    affected,
    held,
    summary: withHold(`${plural(affected, "closed case photo")} deleted`, held),
  };
};

const piiIdVerification: RetentionHandler = async ({
  cutoff,
  policy,
  heldUserIds,
}) => {
  const where = {
    createdAt: { lt: cutoff },
    // A submission still waiting for review is never swept: the reviewer
    // cannot decide on documents that no longer exist.
    status: { in: ["VERIFIED", "EXPIRED", "REJECTED"] },
    OR: [
      { idNumberEncrypted: { not: null } },
      { idImageUrl: { not: null } },
      { selfieUrl: { not: null } },
    ],
  };
  const candidates = await db.identityVerification.findMany({
    where: { ...where, ...holdFilter(policy.key, heldUserIds) },
    select: { id: true, idImageUrl: true, selfieUrl: true },
    take: RETENTION_MAX_ROWS,
  });
  const held =
    heldUserIds.length === 0
      ? 0
      : await db.identityVerification.count({
          where: { ...where, userId: { in: [...heldUserIds] } },
        });

  for (const verification of candidates) {
    for (const url of [verification.idImageUrl, verification.selfieUrl]) {
      await deleteConcernImage(url?.split("/").pop() ?? null);
    }
  }

  if (candidates.length > 0) {
    await db.identityVerification.updateMany({
      where: { id: { in: candidates.map((row) => row.id) } },
      data: {
        idNumberEncrypted: null,
        idNumberLast4: null,
        idNumberHash: null,
        idImageUrl: null,
        selfieUrl: null,
      },
    });
  }

  return {
    scanned: candidates.length,
    affected: candidates.length,
    held,
    summary: withHold(
      `${plural(candidates.length, "ID number and photo")} destroyed; the verification decision is kept`,
      held
    ),
  };
};

const caseRecords: RetentionHandler = async ({
  cutoff,
  policy,
  heldUserIds,
}) => {
  const where = {
    status: "CLOSED",
    closedAt: { not: null, lt: cutoff },
    OR: [
      { locationLat: { not: null } },
      { locationLng: { not: null } },
      { imageUrl: { not: null } },
      { description: { not: ANONYMISED_CASE_NOTE } },
    ],
  };
  const candidates = await db.concern.findMany({
    where: { ...where, ...holdFilter(policy.key, heldUserIds) },
    select: { id: true, imageUrl: true },
    take: RETENTION_MAX_ROWS,
  });
  const held =
    heldUserIds.length === 0
      ? 0
      : await db.concern.count({
          where: { ...where, userId: { in: [...heldUserIds] } },
        });

  for (const concern of candidates) {
    await deleteConcernImage(concern.imageUrl?.split("/").pop() ?? null);
  }

  if (candidates.length > 0) {
    await db.concern.updateMany({
      where: { id: { in: candidates.map((row) => row.id) } },
      data: {
        // The exact pin and the resident's free text go; the coarse geohash,
        // the purok and the case's facts (type, office, dates, costs) stay, so
        // statistics and the audit trail survive the anonymisation.
        locationLat: null,
        locationLng: null,
        locationAccuracyM: null,
        imageUrl: null,
        description: ANONYMISED_CASE_NOTE,
      },
    });
  }

  return {
    scanned: candidates.length,
    affected: candidates.length,
    held,
    summary: withHold(
      `${plural(candidates.length, "closed case")} anonymised`,
      held
    ),
  };
};

const notificationInbox: RetentionHandler = async ({
  cutoff,
  policy,
  heldUserIds,
}) => {
  const where = {
    isRead: true,
    OR: [{ readAt: { lt: cutoff } }, { readAt: null, createdAt: { lt: cutoff } }],
  };
  const held =
    heldUserIds.length === 0
      ? 0
      : await db.notification.count({
          where: { ...where, userId: { in: [...heldUserIds] } },
        });
  const sweepWhere = { ...where, ...holdFilter(policy.key, heldUserIds) };
  const scanned = await db.notification.count({ where: sweepWhere });
  const removed = await db.notification.deleteMany({ where: sweepWhere });
  return {
    scanned,
    affected: removed.count,
    held,
    summary: withHold(`${plural(removed.count, "read notification")} deleted`, held),
  };
};

const revokedTokens: RetentionHandler = async ({ cutoff }) => {
  const where = { expiresAt: { lt: cutoff } };
  const scanned = await db.revokedToken.count({ where });
  const removed = await db.revokedToken.deleteMany({ where });
  return {
    scanned,
    affected: removed.count,
    // A revoked session token is a security artefact, not the resident's
    // personal data: a hold on their records does not keep these alive.
    held: 0,
    summary: `${plural(removed.count, "expired revoked token")} deleted`,
  };
};

/**
 * `ARCHIVE` policies: the rows are counted and reported, and deliberately kept.
 * See rule 1 at the top of this file.
 */
/** Adds the hold count to a summary line, so a run record says what it skipped. */
function withHold(summary: string, held: number): string {
  if (held === 0) return summary;
  return `${summary}; ${plural(held, "row")} held by open data-subject requests`;
}

function archivalHandler(
  count: (context: RetentionContext) => Promise<number>,
  noun: string,
  reason: string
): RetentionHandler {
  return async (context) => {
    const scanned = await count(context);
    return {
      scanned,
      affected: 0,
      // Archival policies delete nothing, so a hold has nothing to protect here.
      held: 0,
      summary: `${plural(scanned, noun)} past the window, kept in place (${reason})`,
    };
  };
}

const piiAccessLog = archivalHandler(
  async ({ cutoff }) => db.piiAccessLog.count({ where: { createdAt: { lt: cutoff } } }),
  "access-log row",
  "accountability: the log is the proof of every unmasking"
);

const auditEntries = archivalHandler(
  async ({ cutoff }) => db.audit.count({ where: { createdAt: { lt: cutoff } } }),
  "audit entry",
  "tamper-evidence: deleting rows would break the hash chain"
);

const dsrRecords = archivalHandler(
  async ({ cutoff }) =>
    db.dataSubjectRequest.count({ where: { requestedAt: { lt: cutoff } } }),
  "data-subject request",
  "compliance: the barangay must be able to show it answered"
);

export const RETENTION_HANDLERS: Record<string, RetentionHandler> = {
  "uploads.concern_images": uploadsConcernImages,
  "pii.id_verification": piiIdVerification,
  "pii.pii_access_log": piiAccessLog,
  "case.records": caseRecords,
  "notification.inbox": notificationInbox,
  "audit.entries": auditEntries,
  "dsr.records": dsrRecords,
  "session.revoked_tokens": revokedTokens,
};

/* ------------------------------------------------------------------- sweep */

export type RetentionRunStatus = "SUCCESS" | "FAILED" | "SKIPPED";

export interface RetentionOutcome {
  policyKey: string;
  policyId: number;
  action: string;
  status: RetentionRunStatus;
  cutoff: Date;
  scanned: number;
  affected: number;
  /** Rows left alone because their resident has an open data-subject request. */
  held: number;
  summary: string | null;
  error: string | null;
}

export interface RetentionSweepResult {
  cronRunId: number;
  startedAt: Date;
  finishedAt: Date;
  outcomes: RetentionOutcome[];
  totals: {
    policies: number;
    succeeded: number;
    failed: number;
    skipped: number;
    scanned: number;
    affected: number;
    held: number;
  };
}

function describeTotals(totals: RetentionSweepResult["totals"]): string {
  return [
    `${totals.policies.toString()} policy(ies)`,
    `${totals.succeeded.toString()} ok`,
    totals.failed > 0 ? `${totals.failed.toString()} failed` : null,
    `${totals.scanned.toString()} scanned`,
    `${totals.affected.toString()} affected`,
    totals.held > 0 ? `${totals.held.toString()} held` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(", ");
}

export async function listRetentionPolicies(): Promise<RetentionPolicyLike[]> {
  const policies = await db.retentionPolicy.findMany({
    select: {
      id: true,
      key: true,
      dataCategory: true,
      retentionDays: true,
      action: true,
      isActive: true,
      lastRunAt: true,
    },
    orderBy: { key: "asc" },
  });
  return policies;
}

/** What the next sweep would do, without doing it. Backs the admin card. */
export async function retentionOverview(
  now: Date = new Date()
): Promise<{ plan: RetentionPlan; lastRun: { startedAt: Date; status: string } | null }> {
  const [policies, lastRun] = await Promise.all([
    listRetentionPolicies(),
    db.retentionRun.findFirst({
      where: { job: RETENTION_JOB },
      select: { startedAt: true, status: true },
      orderBy: { startedAt: "desc" },
    }),
  ]);

  return { plan: planRetention(policies, now), lastRun };
}

/**
 * What the admin privacy desk shows: every policy, the last time it ran, what
 * that run changed, and whether the next sweep would pick it up.
 *
 * This reuses the privacy report's `summarizeRetention` on purpose — the desk
 * and the report must never disagree about how many rows a sweep touched.
 */
export async function retentionDesk(now: Date = new Date()): Promise<{
  rows: ReturnType<typeof summarizeRetention>["rows"];
  totals: { affected: number; runs: number; failures: number };
  dueKeys: string[];
  lastSweepAt: Date | null;
  /** Residents whose rows the next sweep will skip (open data-subject request). */
  heldResidents: number;
}> {
  const [policies, runs, held] = await Promise.all([
    listRetentionPolicies(),
    db.retentionRun.findMany({
      orderBy: { startedAt: "desc" },
      take: 200,
      select: {
        job: true,
        status: true,
        startedAt: true,
        scanned: true,
        affected: true,
        policy: { select: { key: true } },
      },
    }),
    heldResidentIds(),
  ]);

  const plan = planRetention(policies, now);
  const heldResidents = held.length;
  const summary = summarizeRetention(
    policies,
    runs.map((run) => ({
      policyKey: run.policy?.key ?? null,
      job: run.job,
      status: run.status,
      startedAt: run.startedAt,
      scanned: run.scanned,
      affected: run.affected,
    }))
  );

  return {
    rows: summary.rows,
    totals: {
      affected: summary.affected,
      runs: summary.runs,
      failures: summary.failures,
    },
    dueKeys: plan.due.map((policy) => policy.key),
    lastSweepAt: runs[0]?.startedAt ?? null,
    heldResidents,
  };
}

/**
 * Runs one policy and reports what happened. Never throws: a failure is data
 * (it lands in the `RetentionRun` row and in the sweep's response), because a
 * cron that dies on the first bad policy is a cron nobody trusts.
 */
export async function executeRetentionPolicy(
  policy: RetentionPolicyLike,
  options: {
    now?: Date;
    cronRunId?: number | null;
    /** Fetched once per sweep; a standalone call fetches its own list. */
    heldUserIds?: readonly number[];
  } = {}
): Promise<RetentionOutcome> {
  const now = options.now ?? new Date();
  const cutoff = cutoffFor(policy, now);
  const handler = RETENTION_HANDLERS[policy.key];
  const heldUserIds = options.heldUserIds ?? (await heldResidentIds());

  const run = await db.retentionRun.create({
    data: {
      policyId: policy.id,
      job: RETENTION_JOB,
      status: "RUNNING",
      cronRunId: options.cronRunId ?? null,
    },
    select: { id: true },
  });

  if (!handler) {
    const summary = `No handler for policy "${policy.key}": nothing was enforced.`;
    await db.retentionRun.update({
      where: { id: run.id },
      data: {
        status: "SKIPPED",
        finishedAt: now,
        summary,
      },
    });
    return {
      policyKey: policy.key,
      policyId: policy.id,
      action: policy.action,
      status: "SKIPPED",
      cutoff,
      scanned: 0,
      affected: 0,
      held: 0,
      summary,
      error: null,
    };
  }

  try {
    const result = await handler({ policy, cutoff, now, heldUserIds });
    await db.retentionRun.update({
      where: { id: run.id },
      data: {
        status: "SUCCESS",
        finishedAt: new Date(),
        scanned: result.scanned,
        affected: result.affected,
        // The held count travels in the summary text: it is part of what the
        // run did, and the run record is where "what happened that night" is
        // read from. (No schema change — the `RetentionRun` columns are the
        // ones the migration seeded.)
        summary: result.summary,
      },
    });
    await db.retentionPolicy.update({
      where: { id: policy.id },
      data: { lastRunAt: new Date() },
    });

    return {
      policyKey: policy.key,
      policyId: policy.id,
      action: policy.action,
      status: "SUCCESS",
      cutoff,
      scanned: result.scanned,
      affected: result.affected,
      held: result.held,
      summary: result.summary,
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown retention failure.";
    await db.retentionRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        error: message,
      },
    });
    return {
      policyKey: policy.key,
      policyId: policy.id,
      action: policy.action,
      status: "FAILED",
      cutoff,
      scanned: 0,
      affected: 0,
      held: 0,
      summary: null,
      error: message,
    };
  }
}

/**
 * The entry point both the cron route and an admin re-run call.
 *
 * `lastRunAt` is only advanced on success, so a policy that failed is retried
 * by the next sweep instead of being skipped for a day.
 */
export async function runRetentionSweep(
  options: {
    now?: Date;
    triggerSource?: "CRON" | "MANUAL" | "ADMIN";
    actorId?: number | null;
    force?: boolean;
    keys?: readonly string[];
  } = {}
): Promise<RetentionSweepResult> {
  const now = options.now ?? new Date();
  const startedAt = new Date();

  const policies = await listRetentionPolicies();
  const plan = planRetention(policies, now, {
    force: options.force,
    keys: options.keys,
  });
  // One query for the whole sweep: who is on legal hold right now.
  const heldUserIds = await heldResidentIds();

  const cronRun = await db.cronRun.create({
    data: {
      job: RETENTION_JOB,
      status: "RUNNING",
      triggerSource: options.triggerSource ?? "CRON",
      actorId: options.actorId ?? null,
    },
    select: { id: true },
  });

  const outcomes: RetentionOutcome[] = [];
  for (const policy of plan.due) {
    outcomes.push(
      await executeRetentionPolicy(policy, {
        now,
        cronRunId: cronRun.id,
        heldUserIds,
      })
    );
  }

  const finishedAt = new Date();
  const skippedRuns = plan.skipped.filter((skip) => skip.reason !== "NOT_SELECTED").length;
  const totals = {
    policies: plan.due.length,
    succeeded: outcomes.filter((outcome) => outcome.status === "SUCCESS").length,
    failed: outcomes.filter((outcome) => outcome.status === "FAILED").length,
    skipped: skippedRuns,
    scanned: outcomes.reduce((sum, outcome) => sum + outcome.scanned, 0),
    affected: outcomes.reduce((sum, outcome) => sum + outcome.affected, 0),
    held: outcomes.reduce((sum, outcome) => sum + outcome.held, 0),
  };

  const status =
    totals.failed > 0 && totals.succeeded === 0
      ? "FAILED"
      : totals.policies === 0
        ? "SKIPPED"
        : "SUCCESS";

  await db.cronRun.update({
    where: { id: cronRun.id },
    data: {
      status,
      finishedAt,
      processed: totals.policies,
      summary: describeTotals(totals),
      error: totals.failed > 0 ? `${totals.failed.toString()} policy(ies) failed` : null,
    },
  });

  // The sweep deletes and anonymises personal data, so the run itself goes into
  // the hash chain, not just the CronRun log. Logged once per sweep, not per row.
  await recordAudit({
    action: "PRIVACY_RETENTION_SWEEP",
    resourceType: "retention",
    resourceId: String(cronRun.id),
    description: `Retention sweep (${options.triggerSource ?? "CRON"}): ${describeTotals(totals)}`,
    userId: options.actorId ?? null,
  });

  return {
    cronRunId: cronRun.id,
    startedAt,
    finishedAt,
    outcomes,
    totals,
  };
}
