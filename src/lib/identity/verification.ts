// Resident identity verification.
//
// The ID number is personal data: it is encrypted at rest, hashed for
// duplicate detection, and only its last four characters are readable by
// staff (`idNumberLast4`). Decisions are recorded with an actor and a reason,
// and every read of the full value goes through PiiAccessLog.

import { db } from "@/lib/db";
import { createApiError } from "@/lib/api";
import {
  encryptField,
  hasPiiKey,
  lookupHash,
  tail,
} from "@/lib/privacy/crypto";
import { grantConsent } from "@/lib/privacy/consent";
import {
  IDENTITY_GATE_SETTING_KEY,
  applyIdentityExpiry,
  identityGateDecision,
  type IdentityGateDecision,
  type IdentityStatus,
} from "@/lib/identity/policy";
import type { IdentitySubmitInput } from "@/lib/validations/privacy";

export type IdentityState = {
  status: IdentityStatus;
  method: string | null;
  idTypeLabel: string | null;
  idNumberLast4: string | null;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  decisionReason: string | null;
  verifiedAt: Date | null;
  expiresAt: Date | null;
  hasIdImage: boolean;
  hasSelfie: boolean;
  isVerified: boolean;
  isPending: boolean;
  canResubmit: boolean;
};

const EMPTY_STATE: IdentityState = {
  status: "UNVERIFIED",
  method: null,
  idTypeLabel: null,
  idNumberLast4: null,
  submittedAt: null,
  reviewedAt: null,
  decisionReason: null,
  verifiedAt: null,
  expiresAt: null,
  hasIdImage: false,
  hasSelfie: false,
  isVerified: false,
  isPending: false,
  canResubmit: true,
};

type VerificationRow = {
  status: string;
  method: string | null;
  idTypeLabel: string | null;
  idNumberLast4: string | null;
  idImageUrl: string | null;
  selfieUrl: string | null;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  decisionReason: string | null;
  verifiedAt: Date | null;
  expiresAt: Date | null;
};

function toState(row: VerificationRow | null): IdentityState {
  if (!row) return { ...EMPTY_STATE };
  const status = applyIdentityExpiry({
    status: row.status,
    expiresAt: row.expiresAt,
  });
  return {
    status,
    method: row.method,
    idTypeLabel: row.idTypeLabel,
    idNumberLast4: row.idNumberLast4,
    submittedAt: row.submittedAt,
    reviewedAt: row.reviewedAt,
    decisionReason: row.decisionReason,
    verifiedAt: row.verifiedAt,
    expiresAt: row.expiresAt,
    hasIdImage: Boolean(row.idImageUrl),
    hasSelfie: Boolean(row.selfieUrl),
    isVerified: status === "VERIFIED",
    isPending: status === "PENDING",
    canResubmit: status !== "VERIFIED" && status !== "PENDING",
  };
}

/** Verification state for one resident (never throws for a missing row). */
export async function getIdentityState(userId: number): Promise<IdentityState> {
  const row = await db.identityVerification.findUnique({
    where: { userId },
  });
  return toState(row);
}

/** Whether the admin setting keeps the identity gate switched on. */
export async function isIdentityGateEnabled(): Promise<boolean> {
  const row = await db.appSetting.findUnique({
    where: { key: IDENTITY_GATE_SETTING_KEY },
  });
  // Missing row = enabled: verification is the documented default.
  return row?.value !== "false";
}

/** The gate decision for a resident submitting a concern of a given type. */
export async function identityGateFor(
  userId: number,
  concernTypeKey: string | null | undefined
): Promise<IdentityGateDecision> {
  const [state, gateEnabled] = await Promise.all([
    getIdentityState(userId),
    isIdentityGateEnabled(),
  ]);
  return identityGateDecision({
    concernTypeKey,
    status: state.status,
    gateEnabled,
  });
}

/**
 * Throws when the resident may not submit this concern type yet.
 * Used by the concern submission route (stage 3 wires it into the flow).
 */
export async function assertIdentityGate(
  userId: number,
  concernTypeKey: string | null | undefined
): Promise<void> {
  const decision = await identityGateFor(userId, concernTypeKey);
  if (decision.allowed) return;
  throw createApiError.forbidden(decision.message ?? "Identity verification required.");
}

export type SubmitIdentityInput = IdentitySubmitInput & {
  idImageUrl: string | null;
  selfieUrl: string | null;
  ip?: string | null;
  userAgent?: string | null;
};

/**
 * Records a resident's ID submission. Re-submission is allowed while the row is
 * UNVERIFIED, PENDING (corrections) or REJECTED, but a VERIFIED identity must be
 * revoked by an administrator first.
 */
export async function submitIdentity(userId: number, input: SubmitIdentityInput) {
  if (!hasPiiKey()) {
    throw createApiError.internal(
      "Identity documents cannot be processed: the server has no PII encryption key configured."
    );
  }

  const existing = await db.identityVerification.findUnique({
    where: { userId },
  });
  const state = toState(existing);
  if (state.status === "VERIFIED") {
    throw createApiError.conflict(
      "Your identity is already verified. Contact the barangay hall if it needs to be changed."
    );
  }

  await grantConsent({
    userId,
    purpose: "ID_VERIFICATION",
    meta: { method: "WEB", ip: input.ip, userAgent: input.userAgent },
    notes: `Submitted ${input.method} for verification.`,
  });

  const data = {
    status: "PENDING",
    method: input.method,
    idTypeLabel: input.idTypeLabel ?? null,
    idNumberEncrypted: encryptField(input.idNumber),
    idNumberLast4: tail(input.idNumber, 4),
    idNumberHash: lookupHash(input.idNumber),
    idImageUrl: input.idImageUrl,
    selfieUrl: input.selfieUrl,
    submittedAt: new Date(),
    reviewedById: null,
    reviewedAt: null,
    decisionReason: null,
    verifiedAt: null,
  };

  return db.identityVerification.upsert({
    where: { userId },
    update: data,
    create: { userId, ...data },
  });
}

/** Approves or rejects a submission and records who decided and why. */
export async function reviewIdentity({
  userId,
  actorId,
  decision,
  reason,
  expiresAt,
}: {
  userId: number;
  actorId: number;
  decision: "VERIFIED" | "REJECTED";
  reason?: string | null;
  expiresAt?: Date | null;
}) {
  const existing = await db.identityVerification.findUnique({ where: { userId } });
  if (!existing) throw createApiError.notFound("No identity submission found.");

  const now = new Date();
  return db.identityVerification.update({
    where: { userId },
    data: {
      status: decision,
      reviewedById: actorId,
      reviewedAt: now,
      decisionReason: reason ?? null,
      verifiedAt: decision === "VERIFIED" ? now : null,
      expiresAt: decision === "VERIFIED" ? (expiresAt ?? null) : null,
    },
  });
}

/** Queue of submissions for the admin review screen. */
export async function listIdentityQueue(
  filter: { status?: string | null; q?: string | null } = {}
) {
  const where: Record<string, unknown> = {};
  if (filter.status) where.status = filter.status;
  if (filter.q) {
    where.user = {
      OR: [
        { email: { contains: filter.q } },
        { firstName: { contains: filter.q } },
        { lastName: { contains: filter.q } },
      ],
    };
  }

  return db.identityVerification.findMany({
    where,
    include: {
      user: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          address: true,
          isActive: true,
          role: { select: { key: true } },
          office: { select: { id: true, name: true, code: true } },
        },
      },
      reviewedBy: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
    take: 200,
  });
}

/** Counts for the admin dashboard badge. */
export async function identityQueueCounts() {
  const [pending, verified, rejected] = await Promise.all([
    db.identityVerification.count({ where: { status: "PENDING" } }),
    db.identityVerification.count({ where: { status: "VERIFIED" } }),
    db.identityVerification.count({ where: { status: "REJECTED" } }),
  ]);
  return { pending, verified, rejected };
}

/** Resident-facing view of a verification row for API responses. */
export function identityView(row: VerificationRow | null): IdentityState {
  return toState(row);
}
