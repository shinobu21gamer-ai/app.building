// Identity-verification policy (pure).
//
// Verification gates the benefit-bearing concern types (assistance and budget
// requests) and is advisory for the rest; an administrator can switch the gate
// off entirely through the `resident.identity_verification_required` setting.
//
// Staff never see an ID number: only the last four characters are stored in
// the clear (`idNumberLast4`), everything else is encrypted.

export const IDENTITY_STATUSES = [
  "UNVERIFIED",
  "PENDING",
  "VERIFIED",
  "REJECTED",
  "EXPIRED",
] as const;

export type IdentityStatus = (typeof IDENTITY_STATUSES)[number];

export const ID_METHODS = [
  "PHILSYS",
  "UMID",
  "DRIVERS_LICENSE",
  "PASSPORT",
  "BARANGAY_ID",
  "OTHER",
] as const;

export type IdentityMethod = (typeof ID_METHODS)[number];

export const IDENTITY_GATE_SETTING_KEY = "resident.identity_verification_required";

/** Concern types that release money or benefits to the resident. */
export const BENEFIT_CONCERN_TYPES = ["AYUDA", "BUDGET"] as const;

export const IDENTITY_METHOD_LABELS: Record<IdentityMethod, string> = {
  PHILSYS: "PhilSys / National ID",
  UMID: "UMID",
  DRIVERS_LICENSE: "Driver's license",
  PASSPORT: "Passport",
  BARANGAY_ID: "Barangay ID",
  OTHER: "Other government-issued ID",
};

export const IDENTITY_STATUS_LABELS: Record<IdentityStatus, string> = {
  UNVERIFIED: "Not submitted",
  PENDING: "Waiting for review",
  VERIFIED: "Verified",
  REJECTED: "Rejected",
  EXPIRED: "Expired",
};

export function isIdentityStatus(value: unknown): value is IdentityStatus {
  return (
    typeof value === "string" &&
    (IDENTITY_STATUSES as readonly string[]).includes(value)
  );
}

export function isIdentityMethod(value: unknown): value is IdentityMethod {
  return (
    typeof value === "string" && (ID_METHODS as readonly string[]).includes(value)
  );
}

export function identityStatusLabel(status: string): string {
  return isIdentityStatus(status) ? IDENTITY_STATUS_LABELS[status] : status;
}

export function identityMethodLabel(method: string | null): string | null {
  if (!method) return null;
  return isIdentityMethod(method) ? IDENTITY_METHOD_LABELS[method] : method;
}

/** A stored row's effective status: a lapsed verification reads as EXPIRED. */
export function applyIdentityExpiry(
  row: { status: string; expiresAt?: Date | null },
  now: Date = new Date()
): IdentityStatus {
  if (isIdentityStatus(row.status) && row.status === "VERIFIED") {
    if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) {
      return "EXPIRED";
    }
    return "VERIFIED";
  }
  return isIdentityStatus(row.status) ? row.status : "UNVERIFIED";
}

/**
 * A VERIFIED row only counts when it has an attributable, timestamped admin
 * decision. Incomplete legacy rows fail closed into the review queue.
 */
export function effectiveIdentityStatus(
  row: {
    status: string;
    expiresAt?: Date | null;
    submittedAt?: Date | null;
    reviewedById?: number | null;
    reviewedAt?: Date | null;
    verifiedAt?: Date | null;
  },
  now: Date = new Date()
): IdentityStatus {
  if (
    row.status === "VERIFIED" &&
    (row.reviewedById == null || row.reviewedAt == null || row.verifiedAt == null)
  ) {
    return row.submittedAt ? "PENDING" : "UNVERIFIED";
  }
  return applyIdentityExpiry(row, now);
}

/** Whether the concern type releases a benefit and therefore needs a verified ID. */
export function needsVerifiedIdentity(
  concernTypeKey: string | null | undefined
): boolean {
  if (!concernTypeKey) return false;
  return (BENEFIT_CONCERN_TYPES as readonly string[]).includes(
    concernTypeKey.toUpperCase()
  );
}

export type IdentityGateDecision = {
  /** The gate applies to this submission. */
  required: boolean;
  /** Verification is recommended but not blocking (REPAIR / DOCUMENTS). */
  advisory: boolean;
  /** The resident's verification satisfies the gate. */
  satisfied: boolean;
  allowed: boolean;
  code: "IDENTITY_REQUIRED" | "IDENTITY_PENDING" | "IDENTITY_REJECTED" | null;
  message: string | null;
};

/**
 * Decides whether a resident may submit a concern of the given type.
 *
 * `gateEnabled` mirrors the admin setting; when it is false the gate never
 * blocks, which is the escape hatch for a barangay that has not yet rolled out
 * ID verification.
 */
export function identityGateDecision({
  concernTypeKey,
  status,
  gateEnabled,
}: {
  concernTypeKey: string | null | undefined;
  status: string;
  gateEnabled: boolean;
}): IdentityGateDecision {
  const benefitType = needsVerifiedIdentity(concernTypeKey);
  const verified = status === "VERIFIED";

  if (!gateEnabled) {
    return {
      required: false,
      advisory: false,
      satisfied: verified,
      allowed: true,
      code: null,
      message: null,
    };
  }

  if (!benefitType) {
    return {
      required: false,
      advisory: !verified,
      satisfied: verified,
      allowed: true,
      code: null,
      message: verified
        ? null
        : "Identity verification is optional for this type of concern, but it speeds up benefit claims.",
    };
  }

  if (verified) {
    return {
      required: true,
      advisory: false,
      satisfied: true,
      allowed: true,
      code: null,
      message: null,
    };
  }

  if (status === "PENDING") {
    return {
      required: true,
      advisory: false,
      satisfied: false,
      allowed: false,
      code: "IDENTITY_PENDING",
      message:
        "Your identity document is still being reviewed. You can submit this concern once it is verified.",
    };
  }

  if (status === "REJECTED") {
    return {
      required: true,
      advisory: false,
      satisfied: false,
      allowed: false,
      code: "IDENTITY_REJECTED",
      message:
        "Your identity document was rejected. Submit a new one to continue.",
    };
  }

  return {
    required: true,
    advisory: false,
    satisfied: false,
    allowed: false,
    code: "IDENTITY_REQUIRED",
    message:
      "Verify your identity first: assistance and budget concerns require a verified resident.",
  };
}
