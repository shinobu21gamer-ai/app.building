import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  AUDIT_CHAIN_VERSION,
  AUDIT_CHAIN_VERSION_KEYED,
  AUDIT_GENESIS_PREV_HASH,
  auditChainKey,
  checkAuditRows,
  computeAuditHash,
  formatAuditDigest,
  type AuditChainCheck,
  type AuditChainPayload,
  type AuditRowForVerification,
} from "./chain";

// Writing and verifying the hash chain. Pure rules (canonical payload, hashing,
// link checking) live in ./chain; everything here talks to the database.
//
// Concurrency: `AuditChainState` is a singleton row. `appendAuditEntry` takes
// its next `seq` with an `UPDATE ... SET lastSeq = lastSeq + 1 RETURNING`, which
// holds a row lock on that row until the transaction commits. Two concurrent
// audited writes therefore serialise on the tip instead of racing for the same
// `seq`, and a rolled-back transaction releases the seq with it. No raw SQL is
// needed for the lock.

/** The singleton chain-state row. */
export const AUDIT_CHAIN_STATE_ID = 1;

/** Rows inspected per round trip while verifying. */
const VERIFY_BATCH = 500;

type ChainTx = Prisma.TransactionClient;

export type AppendAuditInput = {
  action: string;
  resourceType: string;
  resourceId?: string | null;
  description?: string | null;
  userId?: number | null;
  /** USER | SYSTEM | CRON | ADMIN — stored as a plain string, like the column. */
  actorRole?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  /** Override the row timestamp (tests, backfills). */
  createdAt?: Date;
};

export type AppendAuditResult = {
  seq: bigint;
  hash: string;
  createdAt: Date;
};

/**
 * Appends one chained audit row inside the caller's transaction, so an audited
 * business write and its audit row either both land or neither does.
 */
export async function appendAuditEntry(
  tx: ChainTx,
  input: AppendAuditInput
): Promise<AppendAuditResult> {
  const state = await tx.auditChainState.upsert({
    where: { id: AUDIT_CHAIN_STATE_ID },
    create: {
      id: AUDIT_CHAIN_STATE_ID,
      lastSeq: BigInt(1),
      lastHash: AUDIT_GENESIS_PREV_HASH,
    },
    update: { lastSeq: { increment: 1 } },
  });

  const seq = state.lastSeq;
  const prevHash = state.lastHash;
  const createdAt = input.createdAt ?? new Date();
  const payload: AuditChainPayload = {
    seq,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId ?? null,
    userId: input.userId ?? null,
    actorRole: input.actorRole ?? null,
    description: input.description ?? null,
    ip: input.ip ?? null,
    createdAt,
  };
  const key = auditChainKey();
  const hash = computeAuditHash({ prevHash, payload, key });

  await tx.audit.create({
    data: {
      action: payload.action,
      resourceType: payload.resourceType,
      resourceId: payload.resourceId,
      description: payload.description,
      userId: payload.userId,
      actorRole: payload.actorRole,
      ip: payload.ip,
      userAgent: input.userAgent ?? null,
      createdAt,
      seq,
      prevHash,
      hash,
      chainVersion: key ? AUDIT_CHAIN_VERSION_KEYED : AUDIT_CHAIN_VERSION,
    },
  });

  await tx.auditChainState.update({
    where: { id: AUDIT_CHAIN_STATE_ID },
    data: { lastHash: hash },
  });

  return { seq, hash, createdAt };
}

/** Appends in its own transaction; retries once on a write conflict. */
export async function appendAuditEntryStandalone(
  input: AppendAuditInput,
  attempts = 3
): Promise<AppendAuditResult | null> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await db.$transaction((tx) => appendAuditEntry(tx, input));
    } catch (error) {
      const retryable =
        error instanceof Error &&
        ("code" in error
          ? ["P2002", "P2034", "P2028"].includes(String((error as { code?: string }).code))
          : false);
      if (!retryable || attempt === attempts) {
        console.error("[audit] could not append the chained entry:", error);
        return null;
      }
    }
  }
  return null;
}

export type AuditChainStateView = {
  lastSeq: bigint;
  lastHash: string;
  lastVerifiedSeq: bigint;
  updatedAt: Date | null;
};

export async function loadChainState(
  client: Prisma.TransactionClient | typeof db = db
): Promise<AuditChainStateView> {
  const state = await client.auditChainState.findUnique({
    where: { id: AUDIT_CHAIN_STATE_ID },
  });
  return {
    lastSeq: state?.lastSeq ?? BigInt(0),
    lastHash: state?.lastHash ?? AUDIT_GENESIS_PREV_HASH,
    lastVerifiedSeq: state?.lastVerifiedSeq ?? BigInt(0),
    updatedAt: state?.updatedAt ?? null,
  };
}

export async function countUnchainedAuditEntries(): Promise<number> {
  return db.audit.count({ where: { seq: null } });
}

export type AuditVerificationRunView = {
  id: number;
  status: string;
  fromSeq: bigint;
  toSeq: bigint;
  checkedCount: number;
  firstBrokenSeq: bigint | null;
  detailsJson: string | null;
  triggeredBy: string;
  actorId: number | null;
  startedAt: Date;
  finishedAt: Date | null;
};

export type AuditChainStatus = {
  state: AuditChainStateView;
  totalCount: number;
  chainedCount: number;
  unchainedCount: number;
  tip: { seq: bigint; hash: string; createdAt: Date } | null;
  lastRun: AuditVerificationRunView | null;
  /** True when the last run passed and it covered the current tip. */
  healthy: boolean;
  /** Rows appended after the last successful verification. */
  verifiedLag: number;
};

export async function auditChainStatus(): Promise<AuditChainStatus> {
  const [state, totalCount, unchainedCount, tip, lastRun] = await Promise.all([
    loadChainState(),
    db.audit.count(),
    countUnchainedAuditEntries(),
    db.audit.findFirst({
      where: { seq: { not: null } },
      orderBy: { seq: "desc" },
      select: { seq: true, hash: true, createdAt: true },
    }),
    db.auditVerificationRun.findFirst({ orderBy: { id: "desc" } }),
  ]);

  const healthy = lastRun?.status === "OK" && state.lastVerifiedSeq >= state.lastSeq;
  return {
    state,
    totalCount,
    chainedCount: totalCount - unchainedCount,
    unchainedCount,
    tip:
      tip && tip.seq !== null && tip.hash !== null
        ? { seq: tip.seq, hash: tip.hash, createdAt: tip.createdAt }
        : null,
    lastRun: lastRun ? toRunView(lastRun) : null,
    healthy,
    verifiedLag: Number(state.lastSeq - state.lastVerifiedSeq),
  };
}

function toRunView(row: {
  id: number;
  status: string;
  fromSeq: bigint;
  toSeq: bigint;
  checkedCount: number;
  firstBrokenSeq: bigint | null;
  detailsJson: string | null;
  triggeredBy: string;
  actorId: number | null;
  startedAt: Date;
  finishedAt: Date | null;
}): AuditVerificationRunView {
  return {
    id: row.id,
    status: row.status,
    fromSeq: row.fromSeq,
    toSeq: row.toSeq,
    checkedCount: row.checkedCount,
    firstBrokenSeq: row.firstBrokenSeq,
    detailsJson: row.detailsJson,
    triggeredBy: row.triggeredBy,
    actorId: row.actorId,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

export type AuditVerificationReport = {
  status: "OK" | "BROKEN" | "FAILED";
  fromSeq: bigint;
  toSeq: bigint;
  checkedCount: number;
  firstBrokenSeq: bigint | null;
  problem: string | null;
  boundaryUnverified: boolean;
  unchainedCount: number;
  tipSeq: bigint;
  tipHash: string;
  runId: number | null;
  startedAt: Date;
  finishedAt: Date;
  error: string | null;
};

function toVerificationRow(row: {
  id: number;
  seq: bigint | null;
  prevHash: string | null;
  hash: string | null;
  chainVersion: number | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  userId: number | null;
  actorRole: string | null;
  description: string | null;
  ip: string | null;
  createdAt: Date;
}): AuditRowForVerification {
  return {
    id: row.id,
    seq: row.seq,
    prevHash: row.prevHash,
    hash: row.hash,
    chainVersion: row.chainVersion,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    userId: row.userId,
    actorRole: row.actorRole,
    description: row.description,
    ip: row.ip,
    createdAt: row.createdAt,
  };
}

/**
 * Walks the chain in `seq` order, recomputes every hash and checks every link,
 * then stores the verdict in `AuditVerificationRun`. Never throws: a failure is
 * reported as status FAILED and recorded.
 */
export async function verifyAuditChain(options: {
  triggeredBy: "CRON" | "MANUAL" | "ADMIN";
  actorId?: number | null;
  fromSeq?: bigint | null;
  toSeq?: bigint | null;
  batchSize?: number;
}): Promise<AuditVerificationReport> {
  const startedAt = new Date();
  const state = await loadChainState();
  const fromSeq = options.fromSeq && options.fromSeq > BigInt(0) ? options.fromSeq : BigInt(1);
  const toSeq = options.toSeq && options.toSeq > BigInt(0) ? options.toSeq : state.lastSeq;
  const batchSize = options.batchSize ?? VERIFY_BATCH;
  const unchainedCount = await countUnchainedAuditEntries();

  const run = await db.auditVerificationRun.create({
    data: {
      status: "RUNNING",
      fromSeq,
      toSeq,
      triggeredBy: options.triggeredBy,
      actorId: options.actorId ?? null,
      startedAt,
    },
  });

  let checkedCount = 0;
  let firstBrokenSeq: bigint | null = null;
  let problem: string | null = null;
  let lastSeq: bigint | null = null;
  let lastHash = state.lastHash;
  let boundaryUnverified = fromSeq > BigInt(1);

  try {
    let cursor = fromSeq - BigInt(1);
    // The link into the inspected range is only checkable when the range starts
    // at the genesis row; a partial range reports `boundaryUnverified`.
    let expectedPrev: string | null = fromSeq > BigInt(1) ? null : AUDIT_GENESIS_PREV_HASH;
    let expectedSeq: bigint = fromSeq;

    while (cursor < toSeq) {
      const rows = await db.audit.findMany({
        where: { seq: { gt: cursor, lte: toSeq } },
        orderBy: { seq: "asc" },
        take: batchSize,
      });
      if (rows.length === 0) break;

      const verdict: AuditChainCheck = checkAuditRows(rows.map(toVerificationRow), expectedPrev, {
        expectSeqFrom: expectedSeq,
        key: auditChainKey(),
      });

      checkedCount += verdict.checked;
      if (!verdict.ok) {
        firstBrokenSeq = verdict.firstBrokenSeq;
        problem = verdict.problem;
        break;
      }

      const last = rows[rows.length - 1];
      lastSeq = last.seq ?? null;
      lastHash = last.hash ?? lastHash;
      expectedPrev = last.hash;
      expectedSeq = (last.seq ?? cursor) + BigInt(1);
      cursor = last.seq ?? toSeq;
      boundaryUnverified = boundaryUnverified || verdict.boundaryUnverified;
    }

    // A range that ends before the tip cannot validate the tail of the chain.
    const truncated = toSeq < state.lastSeq;
    const status: "OK" | "BROKEN" = firstBrokenSeq === null ? "OK" : "BROKEN";
    const finishedAt = new Date();

    await db.auditVerificationRun.update({
      where: { id: run.id },
      data: {
        status,
        checkedCount,
        firstBrokenSeq,
        finishedAt,
        detailsJson: JSON.stringify({
          problem,
          unchainedCount,
          boundaryUnverified,
          truncated,
          tipSeq: state.lastSeq.toString(),
          tipHash: state.lastHash,
          checkedToSeq: (lastSeq ?? toSeq - BigInt(1)).toString(),
        }),
      },
    });

    if (status === "OK" && !truncated && state.lastSeq > state.lastVerifiedSeq) {
      await db.auditChainState.update({
        where: { id: AUDIT_CHAIN_STATE_ID },
        data: { lastVerifiedSeq: state.lastSeq },
      });
    }

    return {
      status,
      fromSeq,
      toSeq,
      checkedCount,
      firstBrokenSeq,
      problem,
      boundaryUnverified,
      unchainedCount,
      tipSeq: state.lastSeq,
      tipHash: state.lastHash,
      runId: run.id,
      startedAt,
      finishedAt,
      error: null,
    };
  } catch (error) {
    const finishedAt = new Date();
    const message = error instanceof Error ? error.message : String(error);
    await db.auditVerificationRun
      .update({
        where: { id: run.id },
        data: {
          status: "FAILED",
          checkedCount,
          firstBrokenSeq,
          finishedAt,
          detailsJson: JSON.stringify({ problem: message, unchainedCount }),
        },
      })
      .catch(() => undefined);
    console.error("[audit] chain verification failed to run:", error);
    return {
      status: "FAILED",
      fromSeq,
      toSeq,
      checkedCount,
      firstBrokenSeq,
      problem: message,
      boundaryUnverified,
      unchainedCount,
      tipSeq: state.lastSeq,
      tipHash: state.lastHash,
      runId: run.id,
      startedAt,
      finishedAt,
      error: message,
    };
  }
}

export type AuditEntryFilters = {
  q?: string | null;
  action?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  actorRole?: string | null;
  userId?: number | null;
  chained?: boolean | null;
  from?: Date | null;
  to?: Date | null;
  limit?: number;
  offset?: number;
};

export type AuditEntryRow = {
  id: number;
  seq: bigint | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  description: string | null;
  userId: number | null;
  actorRole: string | null;
  ip: string | null;
  hash: string | null;
  prevHash: string | null;
  createdAt: Date;
  user: { id: number; firstName: string; lastName: string } | null;
};

export async function listAuditEntries(
  filters: AuditEntryFilters = {}
): Promise<{ rows: AuditEntryRow[]; total: number }> {
  const where: Prisma.AuditWhereInput = {};
  if (filters.action) where.action = filters.action;
  if (filters.resourceType) where.resourceType = filters.resourceType;
  if (filters.resourceId) where.resourceId = filters.resourceId;
  if (filters.actorRole) where.actorRole = filters.actorRole;
  if (filters.userId) where.userId = filters.userId;
  if (filters.chained === true) where.seq = { not: null };
  if (filters.chained === false) where.seq = null;
  if (filters.from || filters.to) {
    where.createdAt = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to ? { lte: filters.to } : {}),
    };
  }
  if (filters.q) {
    where.OR = [
      { action: { contains: filters.q, mode: "insensitive" } },
      { resourceType: { contains: filters.q, mode: "insensitive" } },
      { resourceId: { contains: filters.q, mode: "insensitive" } },
      { description: { contains: filters.q, mode: "insensitive" } },
    ];
  }

  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const offset = Math.max(filters.offset ?? 0, 0);

  const [rows, total] = await Promise.all([
    db.audit.findMany({
      where,
      orderBy: [{ seq: "desc" }, { id: "desc" }],
      skip: offset,
      take: limit,
      select: {
        id: true,
        seq: true,
        action: true,
        resourceType: true,
        resourceId: true,
        description: true,
        userId: true,
        actorRole: true,
        ip: true,
        hash: true,
        prevHash: true,
        createdAt: true,
        user: { select: { id: true, firstName: true, lastName: true } },
      },
    }),
    db.audit.count({ where }),
  ]);

  return { rows, total };
}

/**
 * Actions that remove a record. The register at /admin/deleted reads this list,
 * so a new hard delete is added here and it shows up there too.
 */
export const DELETION_ACTIONS = [
  "OFFICE_DELETED",
  "CATEGORY_DELETED",
  "ROUTING_RULE_DELETED",
  "SETTING_DELETED",
  "USER_DELETED",
] as const;

/**
 * The register of deleted records.
 *
 * A deletion in this app is permanent in the database — but never silent: every
 * one of them writes an audit row, and this reads them back so an administrator
 * can see what was removed, when, by whom and from where. "Where did the deleted
 * data go?" is answered with a list rather than a shrug.
 */
export async function listDeletionEntries(filters: {
  q?: string | null;
  limit?: number;
  offset?: number;
} = {}): Promise<{ rows: AuditEntryRow[]; total: number }> {
  const where: Prisma.AuditWhereInput = {
    action: { in: [...DELETION_ACTIONS] },
  };
  if (filters.q) {
    where.OR = [
      { description: { contains: filters.q, mode: "insensitive" } },
      { resourceType: { contains: filters.q, mode: "insensitive" } },
      { resourceId: { contains: filters.q, mode: "insensitive" } },
      { action: { contains: filters.q, mode: "insensitive" } },
    ];
  }

  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const offset = Math.max(filters.offset ?? 0, 0);

  const [rows, total] = await Promise.all([
    db.audit.findMany({
      where,
      orderBy: [{ seq: "desc" }, { id: "desc" }],
      skip: offset,
      take: limit,
      select: {
        id: true,
        seq: true,
        action: true,
        resourceType: true,
        resourceId: true,
        description: true,
        userId: true,
        actorRole: true,
        ip: true,
        hash: true,
        prevHash: true,
        createdAt: true,
        user: { select: { id: true, firstName: true, lastName: true } },
      },
    }),
    db.audit.count({ where }),
  ]);

  return { rows, total };
}

/** Distinct actions / resource types, for the filter controls. */
export async function auditFacets(): Promise<{
  actions: string[];
  resourceTypes: string[];
  actorRoles: string[];
}> {
  const [actions, resourceTypes, actorRoles] = await Promise.all([
    db.audit.findMany({ distinct: ["action"], select: { action: true }, orderBy: { action: "asc" }, take: 100 }),
    db.audit.findMany({
      distinct: ["resourceType"],
      select: { resourceType: true },
      orderBy: { resourceType: "asc" },
      take: 100,
    }),
    db.audit.findMany({
      distinct: ["actorRole"],
      select: { actorRole: true },
      orderBy: { actorRole: "asc" },
      take: 20,
    }),
  ]);
  return {
    actions: actions.map((row) => row.action),
    resourceTypes: resourceTypes.map((row) => row.resourceType),
    actorRoles: actorRoles.map((row) => row.actorRole).filter((v): v is string => Boolean(v)),
  };
}

/**
 * The printable digest of the most recent verification run — the artefact an
 * auditor compares against.
 */
export async function auditDigest(): Promise<{
  lines: string[];
  run: AuditVerificationRunView | null;
  status: AuditChainStatus;
}> {
  const status = await auditChainStatus();
  const run = status.lastRun;
  if (!run) {
    return {
      lines: [
        "BarangayResolve — audit chain digest",
        "No verification run has been recorded yet.",
      ],
      run: null,
      status,
    };
  }
  return {
    lines: formatAuditDigest({
      status: run.status,
      fromSeq: run.fromSeq,
      toSeq: run.toSeq,
      checkedCount: run.checkedCount,
      firstBrokenSeq: run.firstBrokenSeq,
      tipSeq: status.state.lastSeq,
      tipHash: status.state.lastHash,
      unchainedCount: status.unchainedCount,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      triggeredBy: run.triggeredBy,
    }),
    run,
    status,
  };
}

// ---- JSON-safe projections ------------------------------------------------
// `seq` is a BigInt; `JSON.stringify` (and therefore `NextResponse.json`) throws
// on it. Every API response goes through these so the wire format is stable:
// sequence numbers travel as decimal strings.

export function serializeVerificationRun(
  run: AuditVerificationRunView
): Record<string, unknown> {
  return {
    id: run.id,
    status: run.status,
    fromSeq: run.fromSeq.toString(),
    toSeq: run.toSeq.toString(),
    checkedCount: run.checkedCount,
    firstBrokenSeq: run.firstBrokenSeq?.toString() ?? null,
    triggeredBy: run.triggeredBy,
    actorId: run.actorId,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
  };
}

export function serializeChainStatus(status: AuditChainStatus): Record<string, unknown> {
  return {
    lastSeq: status.state.lastSeq.toString(),
    lastHash: status.state.lastHash,
    lastVerifiedSeq: status.state.lastVerifiedSeq.toString(),
    updatedAt: status.state.updatedAt?.toISOString() ?? null,
    totalCount: status.totalCount,
    chainedCount: status.chainedCount,
    unchainedCount: status.unchainedCount,
    tip: status.tip
      ? { seq: status.tip.seq.toString(), hash: status.tip.hash, createdAt: status.tip.createdAt.toISOString() }
      : null,
    lastRun: status.lastRun ? serializeVerificationRun(status.lastRun) : null,
    healthy: status.healthy,
    verifiedLag: status.verifiedLag,
  };
}

export function serializeAuditReport(
  report: AuditVerificationReport
): Record<string, unknown> {
  return {
    status: report.status,
    fromSeq: report.fromSeq.toString(),
    toSeq: report.toSeq.toString(),
    checkedCount: report.checkedCount,
    firstBrokenSeq: report.firstBrokenSeq?.toString() ?? null,
    problem: report.problem,
    boundaryUnverified: report.boundaryUnverified,
    unchainedCount: report.unchainedCount,
    tipSeq: report.tipSeq.toString(),
    tipHash: report.tipHash,
    runId: report.runId,
    startedAt: report.startedAt.toISOString(),
    finishedAt: report.finishedAt.toISOString(),
    error: report.error,
  };
}

export function serializeAuditEntry(row: AuditEntryRow): Record<string, unknown> {
  return {
    id: row.id,
    seq: row.seq?.toString() ?? null,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    description: row.description,
    userId: row.userId,
    actorRole: row.actorRole,
    ip: row.ip,
    hash: row.hash,
    prevHash: row.prevHash,
    createdAt: row.createdAt.toISOString(),
    user: row.user,
  };
}

/**
 * Chains rows written before the chain existed, oldest first, in batches. Safe
 * to re-run: only rows with a null `seq` are touched. Returns how many were
 * chained.
 */
export async function chainLegacyAuditEntries(options?: {
  batchSize?: number;
  onProgress?: (chained: number) => void;
}): Promise<number> {
  const batchSize = options?.batchSize ?? 200;
  let chained = 0;

  for (;;) {
    const batch = await db.audit.findMany({
      where: { seq: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: batchSize,
    });
    if (batch.length === 0) break;

    for (const row of batch) {
      await db.$transaction(async (tx) => {
        const state = await tx.auditChainState.upsert({
          where: { id: AUDIT_CHAIN_STATE_ID },
          create: {
            id: AUDIT_CHAIN_STATE_ID,
            lastSeq: BigInt(1),
            lastHash: AUDIT_GENESIS_PREV_HASH,
          },
          update: { lastSeq: { increment: 1 } },
        });
        const seq = state.lastSeq;
        const prevHash = state.lastHash;
        const key = auditChainKey();
        const hash = computeAuditHash({
          prevHash,
          key,
          payload: {
            seq,
            action: row.action,
            resourceType: row.resourceType,
            resourceId: row.resourceId,
            userId: row.userId,
            actorRole: row.actorRole,
            description: row.description,
            ip: row.ip,
            // The original write time is preserved: backfilling must not change
            // what the log says happened, only chain it.
            createdAt: row.createdAt,
          },
        });
        await tx.audit.update({
          where: { id: row.id },
          data: {
            seq,
            prevHash,
            hash,
            chainVersion: key ? AUDIT_CHAIN_VERSION_KEYED : AUDIT_CHAIN_VERSION,
          },
        });
        await tx.auditChainState.update({
          where: { id: AUDIT_CHAIN_STATE_ID },
          data: { lastHash: hash },
        });
      });
      chained += 1;
      if (chained % 50 === 0) options?.onProgress?.(chained);
    }
  }

  options?.onProgress?.(chained);
  return chained;
}
