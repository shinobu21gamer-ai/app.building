// Data-subject requests, erasure execution and PII access logging.
//
// RA 10173 gives residents the right to be informed, to object, to access, to
// rectify and to erase their personal data. This module implements the
// operational half of that:
//   * requests are filed with a human-readable reference (DSR-YYYY-NNNN) and a
//     statutory 15-working-day deadline,
//   * an approved erasure anonymises the resident's identity while retaining
//     the case records the barangay must keep for its own legal obligations —
//     what was erased and what was retained is written into ErasureExecution,
//   * every unmasking of personal data is appended to PiiAccessLog with the
//     reason the actor gave.

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { createApiError } from "@/lib/api";
import { piiKeyProblemMessage, piiKeyStatus } from "@/lib/privacy/crypto";
import { readablePhone } from "@/lib/privacy/phone-store";
import { unpublishResidentRecords } from "@/lib/cases/public-record";
import {
  addWorkingDays,
  dsrReferencePrefix,
  formatDsrReference,
  manilaYear,
  DSR_STATUTORY_WORKING_DAYS,
} from "@/lib/privacy/dates";
import {
  isDsrStatus,
  isDsrType,
  type DsrStatus,
  type DsrType,
} from "@/lib/privacy/catalog";

type Tx = Prisma.TransactionClient;

/**
 * Requests a resident may file per 24 hours. Counted from the request table
 * itself so the limit cannot be gamed by switching networks, and so it never
 * consumes the shared login/registration throttle bucket.
 *
 * Enforced inside `createDataSubjectRequest`'s own transaction (see the
 * `FOR UPDATE` lock there) — a pre-check in the API route alone would be a
 * check-then-act race: several requests arriving at once could each read
 * "4 so far" and all proceed, filing far more than the limit.
 */
export const DSR_MAX_PER_DAY = 5;

/** Clear error when a deployment has no key but tries to store personal data. */
export function assertPiiConfigured(): void {
  const status = piiKeyStatus();
  if (!status.ready) {
    throw createApiError.internal(
      `Personal-data encryption is unavailable: ${piiKeyProblemMessage(status)}`
    );
  }
}

// --------------------------------------------------------------- references

/**
 * Next reference for the current Manila year: `DSR-2026-0007`.
 * Counting (not max-sorting) keeps working past 9999 requests, and the unique
 * index on `referenceCode` is the real guard; callers retry on conflict.
 */
export async function generateDsrReference(tx: Tx): Promise<string> {
  const year = manilaYear();
  const prefix = dsrReferencePrefix(year);
  const count = await tx.dataSubjectRequest.count({
    where: { referenceCode: { startsWith: prefix } },
  });
  return formatDsrReference(year, count + 1);
}

function isReferenceConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

// ----------------------------------------------------------------- requests

export type CreateDsrInput = {
  userId: number;
  type: DsrType;
  details?: string | null;
};

export async function createDataSubjectRequest(input: CreateDsrInput) {
  if (!isDsrType(input.type)) {
    throw createApiError.badRequest("Unknown request type.");
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await db.$transaction(async (tx) => {
        // Lock this resident's user row before counting today's requests, so
        // two (or fifteen) submissions racing in parallel cannot each read
        // "4 so far" under the limit and all be allowed through — the second
        // and later transactions block here until the first commits, then
        // see its row and correctly hit the cap.
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${input.userId} FOR UPDATE`;

        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const recent = await tx.dataSubjectRequest.count({
          where: { userId: input.userId, requestedAt: { gte: since } },
        });
        if (recent >= DSR_MAX_PER_DAY) {
          throw createApiError.tooManyRequests(
            `You have already filed ${DSR_MAX_PER_DAY} requests today. Call the barangay hall if it is urgent.`
          );
        }

        const referenceCode = await generateDsrReference(tx);
        return tx.dataSubjectRequest.create({
          data: {
            referenceCode,
            userId: input.userId,
            type: input.type,
            status: "RECEIVED",
            details: input.details ?? null,
            scopeJson: JSON.stringify({
              categories: [
                "profile",
                "contact",
                "identity",
                "cases",
                "notifications",
              ],
            }),
            dueAt: addWorkingDays(new Date(), DSR_STATUTORY_WORKING_DAYS),
          },
        });
      });
    } catch (error) {
      if (isReferenceConflict(error) && attempt < 4) continue;
      throw error;
    }
  }
  throw createApiError.conflict(
    "Could not allocate a request reference. Please try again."
  );
}

export async function listMyDataSubjectRequests(userId: number) {
  return db.dataSubjectRequest.findMany({
    where: { userId },
    orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
    take: 100,
  });
}

/** Requests filed by a resident in the last `hours` (default: one day). */
export async function countRecentDsr(
  userId: number,
  hours = 24
): Promise<number> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  return db.dataSubjectRequest.count({
    where: { userId, requestedAt: { gte: since } },
  });
}

export type DsrFilters = {
  status?: string | null;
  type?: string | null;
  q?: string | null;
  overdueOnly?: boolean;
};

export async function listDataSubjectRequests(filters: DsrFilters = {}) {
  const where: Prisma.DataSubjectRequestWhereInput = {};
  if (filters.status && isDsrStatus(filters.status)) where.status = filters.status;
  if (filters.type && isDsrType(filters.type)) where.type = filters.type;
  if (filters.overdueOnly) {
    where.status = { in: ["RECEIVED", "IN_REVIEW"] };
    where.dueAt = { lt: new Date() };
  }
  if (filters.q) {
    where.OR = [
      { referenceCode: { contains: filters.q } },
      { user: { email: { contains: filters.q } } },
      { user: { firstName: { contains: filters.q } } },
      { user: { lastName: { contains: filters.q } } },
    ];
  }

  return db.dataSubjectRequest.findMany({
    where,
    include: {
      user: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phoneLast4: true,
          phoneEncrypted: true,
          phone: true,
        },
      },
      handledBy: { select: { id: true, firstName: true, lastName: true } },
      erasureExecution: { select: { id: true, executedAt: true } },
    },
    orderBy: [{ dueAt: "asc" }, { id: "asc" }],
    take: 200,
  });
}

export async function dsrCounts() {
  const [received, inReview, completed, rejected] = await Promise.all([
    db.dataSubjectRequest.count({ where: { status: "RECEIVED" } }),
    db.dataSubjectRequest.count({ where: { status: "IN_REVIEW" } }),
    db.dataSubjectRequest.count({ where: { status: "COMPLETED" } }),
    db.dataSubjectRequest.count({ where: { status: "REJECTED" } }),
  ]);
  const overdue = await db.dataSubjectRequest.count({
    where: { status: { in: ["RECEIVED", "IN_REVIEW"] }, dueAt: { lt: new Date() } },
  });
  return { received, inReview, completed, rejected, overdue };
}

/**
 * Moves a request forward. Completing an ERASURE request executes the erasure
 * in the same transaction, so a request can never be marked done while the
 * data is still there.
 */
export async function handleDataSubjectRequest({
  id,
  actorId,
  status,
  resolutionNotes,
  denialReason,
}: {
  id: number;
  actorId: number;
  /** RECEIVED is the state a request starts in, so it can never be set here. */
  status: DsrStatus;
  resolutionNotes?: string | null;
  denialReason?: string | null;
}) {
  if (!isDsrStatus(status) || status === "RECEIVED") {
    throw createApiError.badRequest("Invalid request status.");
  }

  const request = await db.dataSubjectRequest.findUnique({ where: { id } });
  if (!request) throw createApiError.notFound("Request not found.");
  if (request.status === "COMPLETED" || request.status === "REJECTED") {
    throw createApiError.conflict("This request has already been closed.");
  }

  if (status === "COMPLETED" && request.type === "ERASURE") {
    await db.$transaction(async (tx) => {
      await executeErasure(tx, { requestId: request.id, subjectUserId: request.userId, actorId });
      await tx.dataSubjectRequest.update({
        where: { id },
        data: {
          status: "COMPLETED",
          handledById: actorId,
          resolvedAt: new Date(),
          resolutionNotes: resolutionNotes ?? null,
        },
      });
    });
    return db.dataSubjectRequest.findUniqueOrThrow({ where: { id } });
  }

  return db.dataSubjectRequest.update({
    where: { id },
    data: {
      status,
      handledById: actorId,
      resolvedAt: status === "COMPLETED" || status === "REJECTED" ? new Date() : null,
      resolutionNotes: resolutionNotes ?? null,
      denialReason: denialReason ?? null,
    },
  });
}

// ----------------------------------------------------------------- erasure

const RETAINED_CATEGORIES = [
  {
    category: "case_records",
    reason:
      "Barangay case files (Concern, CaseStatusHistory, ResolutionRecord) are retained as public records under the barangay's legal obligation; they no longer identify the requester after anonymisation.",
  },
  {
    category: "audit_log",
    reason:
      "Audit entries are retained for accountability and fraud prevention (RA 10173 §12(f)).",
  },
  {
    category: "treasury_records",
    reason:
      "Disbursements and ledger entries are retained under COA record-keeping rules.",
  },
];

/**
 * Anonymises a resident's identity. Runs inside the caller's transaction so the
 * erasure and the request status change commit together.
 *
 * Returns a report of what was erased and what was retained.
 */
export async function executeErasure(
  tx: Tx,
  {
    requestId,
    subjectUserId,
    actorId,
  }: { requestId: number; subjectUserId: number; actorId?: number | null }
) {
  const existing = await tx.erasureExecution.findUnique({
    where: { requestId },
  });
  if (existing) return existing;

  const user = await tx.user.findUnique({ where: { id: subjectUserId } });
  if (!user) throw createApiError.notFound("Resident not found.");

  const alreadyAnonymised = user.email.startsWith("erased+");
  const anonymisedEmail = `erased+${subjectUserId}@erased.invalid`;

  const consents = await tx.consentRecord.updateMany({
    where: { userId: subjectUserId, status: "GRANTED" },
    data: { status: "WITHDRAWN", withdrawnAt: new Date() },
  });

  // The resident is being anonymised, so nothing of theirs may stay on the
  // public transparency page — the consent rows above are withdrawn in the same
  // transaction, but a published projection would otherwise survive them.
  const publicRecordsUnpublished = await unpublishResidentRecords(
    tx,
    subjectUserId
  );

  const identities = await tx.identityVerification.updateMany({
    where: { userId: subjectUserId },
    data: {
      status: "EXPIRED",
      idNumberEncrypted: null,
      idNumberLast4: null,
      idNumberHash: null,
      idImageUrl: null,
      selfieUrl: null,
      decisionReason: `Identity data erased under data subject request #${requestId}.`,
    },
  });

  if (!alreadyAnonymised) {
    await tx.user.update({
      where: { id: subjectUserId },
      data: {
        firstName: "Erased",
        lastName: `Resident #${subjectUserId}`,
        email: anonymisedEmail,
        phone: null,
        phoneEncrypted: null,
        phoneLast4: null,
        phoneHash: null,
        phoneVerifiedAt: null,
        address: null,
        position: null,
        isActive: false,
        // Revokes every session the resident still has open.
        tokenVersion: { increment: 1 },
      },
    });
  }

  const report = {
    requestId,
    subjectUserId,
    alreadyAnonymised,
    erased: [
      "name",
      "email",
      "phone",
      "address",
      "position",
      "identity_document",
      "consents",
      "public_case_projection",
    ],
    consentRowsWithdrawn: consents.count,
    identityRowsCleared: identities.count,
    publicRecordsUnpublished,
    retainedCategories: RETAINED_CATEGORIES,
    executedAt: new Date().toISOString(),
  };

  return tx.erasureExecution.create({
    data: {
      requestId,
      executedById: actorId ?? null,
      scopeJson: JSON.stringify({ userId: subjectUserId }),
      retainedCategoriesJson: JSON.stringify(RETAINED_CATEGORIES),
      reportJson: JSON.stringify(report),
    },
  });
}

// -------------------------------------------------------- PII access log

export type PiiAccessInput = {
  actorId: number | null;
  subjectUserId: number;
  field: string;
  purpose: string;
  resourceType?: string | null;
  resourceId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
};

/**
 * Appends a PII access entry. Never throws: the log must not be able to break
 * the operation it records, and the caller has already checked permissions.
 */
export async function logPiiAccess(input: PiiAccessInput): Promise<void> {
  try {
    await db.piiAccessLog.create({
      data: {
        actorId: input.actorId,
        subjectUserId: input.subjectUserId,
        field: input.field,
        purpose: input.purpose,
        resourceType: input.resourceType ?? null,
        resourceId: input.resourceId ?? null,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
  } catch (error) {
    console.error("[privacy] failed to record PII access:", error);
  }
}

/**
 * Unmasks a resident's phone number for an administrator who gave a reason.
 * The caller must hold `privacy.pii_access.view`; this function records the
 * access and returns the number (or null when none is on file).
 */
export async function revealPhone({
  actorId,
  subjectUserId,
  reason,
  resourceType = "user",
  resourceId,
  ip,
  userAgent,
}: {
  actorId: number | null;
  subjectUserId: number;
  reason: string;
  resourceType?: string | null;
  resourceId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<string | null> {
  const user = await db.user.findUnique({
    where: { id: subjectUserId },
    select: { phone: true, phoneEncrypted: true, phoneLast4: true },
  });
  if (!user) throw createApiError.notFound("Resident not found.");

  await logPiiAccess({
    actorId,
    subjectUserId,
    field: "phone",
    purpose: reason,
    resourceType,
    resourceId: resourceId ?? String(subjectUserId),
    ip,
    userAgent,
  });

  try {
    return readablePhone(user);
  } catch {
    throw createApiError.badRequest(
      "The stored number could not be decrypted. Check the PII encryption key."
    );
  }
}

/** Recent unmasking entries for the admin privacy screen. */
export async function recentPiiAccessLog(take = 100) {
  return db.piiAccessLog.findMany({
    include: {
      actor: { select: { id: true, firstName: true, lastName: true, email: true } },
      subjectUser: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
  });
}
