// Consent records (RA 10173 §12–13).
//
// Consent is append-only history: granting again writes a new row, withdrawing
// stamps the current row. The "current" state of a purpose is therefore the
// most recent row for it, which this module derives for callers.

import { db } from "@/lib/db";
import { createApiError } from "@/lib/api";
import {
  CONSENT_PURPOSES,
  PRIVACY_POLICY_VERSION,
  isConsentPurpose,
  type ConsentPurpose,
  type ConsentStatus,
} from "@/lib/privacy/catalog";

export type ConsentState = {
  purpose: ConsentPurpose;
  status: ConsentStatus;
  policyVersion: string;
  grantedAt: Date;
  withdrawnAt: Date | null;
};

type ConsentClient = Pick<typeof db, "consentRecord">;

export type ConsentMeta = {
  method?: "WEB" | "ANDROID" | "ADMIN";
  ip?: string | null;
  userAgent?: string | null;
};

const CONSENT_RECORD_ORDER = { createdAt: "asc" } as const;

/** Most recent row per purpose, in catalogue order. */
export async function currentConsents(
  userId: number,
  client: ConsentClient = db
): Promise<ConsentState[]> {
  const rows = await client.consentRecord.findMany({
    where: { userId },
    orderBy: CONSENT_RECORD_ORDER,
  });

  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) latest.set(row.purpose, row);

  return CONSENT_PURPOSES.filter((purpose) => latest.has(purpose)).map(
    (purpose) => {
      const row = latest.get(purpose)!;
      return {
        purpose,
        status: row.status === "WITHDRAWN" ? "WITHDRAWN" : "GRANTED",
        policyVersion: row.policyVersion,
        grantedAt: row.grantedAt,
        withdrawnAt: row.withdrawnAt,
      };
    }
  );
}

/** Whether the purpose is currently granted. Unknown purposes are not granted. */
export async function hasConsent(
  userId: number,
  purpose: ConsentPurpose,
  client: ConsentClient = db
): Promise<boolean> {
  const rows = await currentConsents(userId, client);
  return rows.some((row) => row.purpose === purpose && row.status === "GRANTED");
}

/**
 * Records a grant. Idempotent: granting a purpose that is already granted with
 * the same notice version returns the existing state instead of appending a
 * duplicate row.
 */
export async function grantConsent({
  userId,
  purpose,
  notes,
  meta,
  policyVersion = PRIVACY_POLICY_VERSION,
}: {
  userId: number;
  purpose: ConsentPurpose;
  notes?: string | null;
  meta?: ConsentMeta;
  policyVersion?: string;
}): Promise<ConsentState> {
  if (!isConsentPurpose(purpose)) {
    throw createApiError.badRequest("Unknown consent purpose.");
  }

  const current = (await currentConsents(userId)).find(
    (row) => row.purpose === purpose
  );
  if (current?.status === "GRANTED" && current.policyVersion === policyVersion) {
    return current;
  }

  const row = await db.consentRecord.create({
    data: {
      userId,
      purpose,
      status: "GRANTED",
      policyVersion,
      method: meta?.method ?? "WEB",
      ip: meta?.ip ?? null,
      userAgent: meta?.userAgent ?? null,
      notes: notes ?? null,
    },
  });

  return {
    purpose,
    status: "GRANTED",
    policyVersion: row.policyVersion,
    grantedAt: row.grantedAt,
    withdrawnAt: null,
  };
}

/**
 * Withdraws a granted purpose. Returns null when there was nothing to
 * withdraw, so the caller can respond 404/409 without treating it as an error.
 */
export async function withdrawConsent({
  userId,
  purpose,
  notes,
}: {
  userId: number;
  purpose: ConsentPurpose;
  notes?: string | null;
}): Promise<ConsentState | null> {
  const rows = await db.consentRecord.findMany({
    where: { userId, purpose, status: "GRANTED" },
    orderBy: CONSENT_RECORD_ORDER,
  });
  const latest = rows[rows.length - 1];
  if (!latest) return null;

  const updated = await db.consentRecord.update({
    where: { id: latest.id },
    data: {
      status: "WITHDRAWN",
      withdrawnAt: new Date(),
      notes: notes ?? latest.notes,
    },
  });

  return {
    purpose,
    status: "WITHDRAWN",
    policyVersion: updated.policyVersion,
    grantedAt: updated.grantedAt,
    withdrawnAt: updated.withdrawnAt ?? new Date(),
  };
}

/** Throws 403 when the purpose is not currently granted. */
export async function assertConsent(
  userId: number,
  purpose: ConsentPurpose,
  message = "This action needs your consent for that use of your data."
): Promise<void> {
  if (!(await hasConsent(userId, purpose))) {
    throw createApiError.forbidden(message);
  }
}

/** Grants several purposes at once (registration), skipping duplicates. */
export async function grantConsents(
  userId: number,
  purposes: readonly ConsentPurpose[],
  meta?: ConsentMeta
): Promise<ConsentState[]> {
  const granted: ConsentState[] = [];
  for (const purpose of purposes) {
    granted.push(await grantConsent({ userId, purpose, meta }));
  }
  return granted;
}

/** Plain summary used by API responses and the privacy page. */
export function consentSummary(rows: readonly ConsentState[]) {
  return {
    granted: rows.filter((row) => row.status === "GRANTED").map((r) => r.purpose),
    withdrawn: rows
      .filter((row) => row.status === "WITHDRAWN")
      .map((r) => r.purpose),
    policyVersion: PRIVACY_POLICY_VERSION,
  };
}
