// Pure treasury rules: money arithmetic, the append-only ledger snapshots, the
// voucher approval order and the aging buckets. No database and no framework
// imports, so the arithmetic that decides whether a peso may be spent is unit
// testable — see `ledger.test.ts`.
//
// Money rule for the whole module: every amount is exchanged as a number of
// pesos rounded to two decimals through `roundMoney`, and a Prisma `Decimal`
// is always converted before arithmetic (`toMoney`). Nothing here renders a
// `Decimal` into JSX or a template string directly.

import { roundMoney } from "@/lib/cases/manpower";

export { formatPeso, roundMoney } from "@/lib/cases/manpower";

/** Prisma returns `Decimal`; strings come from JSON; both become numbers. */
export function toMoney(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return roundMoney(value);
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? roundMoney(parsed) : 0;
  }
  if (typeof value === "object" && "toNumber" in (value as object)) {
    const candidate = value as { toNumber: () => number };
    try {
      const parsed = candidate.toNumber();
      return Number.isFinite(parsed) ? roundMoney(parsed) : 0;
    } catch {
      return 0;
    }
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Status catalogues
// ---------------------------------------------------------------------------

export const ALLOCATION_STATUSES = ["DRAFT", "APPROVED", "CLOSED"] as const;
export type AllocationStatus = (typeof ALLOCATION_STATUSES)[number];

export const EARMARK_STATUSES = [
  "PROPOSED",
  "APPROVED",
  "RELEASED",
  "CANCELLED",
] as const;
export type EarmarkStatus = (typeof EARMARK_STATUSES)[number];

export const DISBURSEMENT_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "CERTIFIED",
  "APPROVED",
  "RELEASED",
  "LIQUIDATED",
  "REJECTED",
  "CANCELLED",
] as const;
export type DisbursementStatus = (typeof DISBURSEMENT_STATUSES)[number];

export const LEDGER_ENTRY_TYPES = [
  "APPROPRIATION",
  "ALLOCATION_ADJUSTMENT",
  "EARMARK_RESERVE",
  "EARMARK_RELEASE",
  "EARMARK_CANCEL",
  "DISBURSEMENT_RESERVE",
  "DISBURSEMENT_RELEASE",
  "DISBURSEMENT_CANCEL",
  "LIQUIDATION",
] as const;
export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];

export const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  PROPOSED: "Proposed",
  SUBMITTED: "Submitted",
  CERTIFIED: "Funds certified",
  APPROVED: "Approved",
  RELEASED: "Released",
  LIQUIDATED: "Liquidated",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
  CLOSED: "Closed",
  APPROPRIATION: "Appropriation opened",
  ALLOCATION_ADJUSTMENT: "Adjustment",
  EARMARK_RESERVE: "Earmark reserved",
  EARMARK_RELEASE: "Earmark released",
  EARMARK_CANCEL: "Earmark reservation released",
  DISBURSEMENT_RESERVE: "Voucher reserved",
  DISBURSEMENT_RELEASE: "Voucher paid",
  DISBURSEMENT_CANCEL: "Reservation released",
  LIQUIDATION: "Liquidation recorded",
};

export function statusLabel(status: string): string {
  return (
    STATUS_LABELS[status] ??
    status.replaceAll("_", " ").toLowerCase().replace(/^./, (c) => c.toUpperCase())
  );
}

// ---------------------------------------------------------------------------
// Ledger snapshots (append-only)
// ---------------------------------------------------------------------------

export type LedgerSnapshot = {
  appropriated: number;
  reserved: number;
  disbursed: number;
  available: number;
};

export type LedgerDeltas = {
  reservedDelta?: number | string | null;
  disbursedDelta?: number | string | null;
};

export function emptySnapshot(appropriation: unknown): LedgerSnapshot {
  const appropriated = toMoney(appropriation);
  return {
    appropriated,
    reserved: 0,
    disbursed: 0,
    available: appropriated,
  };
}

/** Applies deltas to a snapshot. Available never goes below zero silently: the
 * caller must have checked `checkAvailability` first, and an overdraw shows up
 * as a negative available figure rather than being hidden. */
export function applyDeltas(
  snapshot: LedgerSnapshot,
  deltas: LedgerDeltas
): LedgerSnapshot {
  const reserved = roundMoney(snapshot.reserved + toMoney(deltas.reservedDelta));
  const disbursed = roundMoney(
    snapshot.disbursed + toMoney(deltas.disbursedDelta)
  );
  return {
    appropriated: snapshot.appropriated,
    reserved,
    disbursed,
    available: roundMoney(snapshot.appropriated - reserved - disbursed),
  };
}

type LedgerRow = {
  reservedDelta?: unknown;
  disbursedDelta?: unknown;
  reservedAfter?: unknown;
  disbursedAfter?: unknown;
  availableAfter?: unknown;
};

/**
 * The live balance of an allocation. The newest ledger entry is authoritative
 * (it carries the running totals); when an allocation has no entries yet the
 * appropriation is the opening figure. `recomputed` is derived from the deltas
 * alone, which is what an audit recomputation would produce.
 */
export function snapshotFromEntries(
  appropriation: unknown,
  entries: readonly LedgerRow[]
): LedgerSnapshot & { recomputed: LedgerSnapshot; entryCount: number } {
  const opening = emptySnapshot(appropriation);
  if (entries.length === 0) {
    return { ...opening, recomputed: opening, entryCount: 0 };
  }

  const newest = entries[entries.length - 1];
  const latest: LedgerSnapshot = {
    appropriated: toMoney(appropriation),
    reserved: toMoney(newest.reservedAfter),
    disbursed: toMoney(newest.disbursedAfter),
    available: toMoney(newest.availableAfter),
  };

  let recomputed = opening;
  for (const entry of entries) {
    recomputed = applyDeltas(recomputed, {
      reservedDelta: toMoney(entry.reservedDelta),
      disbursedDelta: toMoney(entry.disbursedDelta),
    });
  }

  return { ...latest, recomputed, entryCount: entries.length };
}

export type AvailabilityCheck = {
  ok: boolean;
  available: number;
  shortfall: number;
  message: string | null;
};

/** The no-overspend rule. `amount` is what the caller wants to commit. */
export function checkAvailability(input: {
  available: unknown;
  amount: unknown;
  label?: string;
}): AvailabilityCheck {
  const available = toMoney(input.available);
  const amount = toMoney(input.amount);
  const label = input.label ?? "This allocation";

  if (amount <= 0) {
    return {
      ok: false,
      available,
      shortfall: 0,
      message: "The amount must be more than zero.",
    };
  }
  if (amount > available) {
    const shortfall = roundMoney(amount - available);
    return {
      ok: false,
      available,
      shortfall,
      message:
        `${label} only has ` +
        `₱${available.toFixed(2)} available. Reduce the amount by ` +
        `₱${shortfall.toFixed(2)}, or ask for a supplemental appropriation first.`,
    };
  }
  return { ok: true, available, shortfall: 0, message: null };
}

/**
 * What a commitment leaves behind, given the current reserved/disbursed
 * figures. Used by confirmation screens ("this voucher reserves ₱X, leaving
 * ₱Y available") and by the tests.
 */
export function projectCommitment(input: {
  appropriation: unknown;
  reserved: unknown;
  disbursed: unknown;
  reservedDelta?: unknown;
  disbursedDelta?: unknown;
}): LedgerSnapshot {
  const reservedDelta = toMoney(input.reservedDelta);
  const disbursedDelta = toMoney(input.disbursedDelta);
  return applyDeltas(
    {
      appropriated: toMoney(input.appropriation),
      reserved: toMoney(input.reserved),
      disbursed: toMoney(input.disbursed),
      available: roundMoney(
        toMoney(input.appropriation) -
          toMoney(input.reserved) -
          toMoney(input.disbursed)
      ),
    },
    { reservedDelta, disbursedDelta }
  );
}

// ---------------------------------------------------------------------------
// Voucher lifecycle
// ---------------------------------------------------------------------------

export const DISBURSEMENT_ACTIONS = [
  "SUBMIT",
  "CERTIFY",
  "APPROVE",
  "REJECT",
  "RELEASE",
  "LIQUIDATE",
  "CANCEL",
] as const;
export type DisbursementAction = (typeof DISBURSEMENT_ACTIONS)[number];

/** Which actions a status allows. Rejected and cancelled vouchers are final. */
export function disbursementActions(
  status: string
): readonly DisbursementAction[] {
  switch (status) {
    case "DRAFT":
      return ["SUBMIT", "CANCEL"];
    case "SUBMITTED":
      return ["CERTIFY", "REJECT", "CANCEL"];
    case "CERTIFIED":
      return ["APPROVE", "REJECT", "CANCEL"];
    case "APPROVED":
      return ["RELEASE", "CANCEL"];
    case "RELEASED":
      return ["LIQUIDATE"];
    default:
      return [];
  }
}

export function actionAllowed(
  status: string,
  action: DisbursementAction
): boolean {
  return disbursementActions(status).includes(action);
}

/** Whether the voucher still holds part of the allocation (a reservation). */
export function holdsReservation(status: string): boolean {
  return ["CERTIFIED", "APPROVED", "SUBMITTED"].includes(status);
}

/** Whether the money has actually left the barangay. */
export function isPaid(status: string): boolean {
  return status === "RELEASED" || status === "LIQUIDATED";
}

/** Days allowed to liquidate a released voucher. */
export const LIQUIDATION_DAYS = 30;

export function addDays(from: Date, days: number): Date {
  const result = new Date(from.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export function liquidationDueFrom(
  releasedAt: Date,
  days: number = LIQUIDATION_DAYS
): Date {
  return addDays(releasedAt, days);
}

export type LiquidationState =
  | "NOT_APPLICABLE"
  | "NOT_DUE"
  | "DUE_SOON"
  | "OVERDUE"
  | "LIQUIDATED";

export function liquidationState(
  input: {
    status: string;
    liquidationDueAt?: Date | null;
    liquidationStatus?: string | null;
  },
  now: Date = new Date()
): LiquidationState {
  if (input.liquidationStatus === "LIQUIDATED" || input.status === "LIQUIDATED") {
    return "LIQUIDATED";
  }
  if (!isPaid(input.status) || !input.liquidationDueAt) return "NOT_APPLICABLE";
  const remaining = input.liquidationDueAt.getTime() - now.getTime();
  if (remaining <= 0) return "OVERDUE";
  if (remaining <= 7 * 24 * 60 * 60 * 1000) return "DUE_SOON";
  return "NOT_DUE";
}

export function liquidationLabel(state: LiquidationState): string {
  switch (state) {
    case "LIQUIDATED":
      return "Liquidated";
    case "OVERDUE":
      return "Liquidation overdue";
    case "DUE_SOON":
      return "Liquidation due within a week";
    case "NOT_DUE":
      return "Awaiting liquidation";
    default:
      return "—";
  }
}

// ---------------------------------------------------------------------------
// Approval order and separation of duties
// ---------------------------------------------------------------------------

/** Level 1 is the treasurer's "funds are available" certification, level 2 the
 * Captain's (Authorized Approving Official) release approval. */
export const APPROVAL_LEVELS = {
  FUNDS_AVAILABLE: 1,
  AAO_RELEASE: 2,
} as const;

export const APPROVAL_DECISIONS = ["CERTIFIED", "APPROVED", "REJECTED"] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

export type ApprovalRow = {
  level: number;
  approverId: number;
  decision: string;
};

/** The level this voucher is waiting on, or null when nothing is pending. */
export function nextApprovalLevel(
  approvals: readonly ApprovalRow[]
): 1 | 2 | null {
  const decided = new Set(
    approvals
      .filter((row) => row.decision !== "REJECTED")
      .map((row) => row.level)
  );
  if (!decided.has(APPROVAL_LEVELS.FUNDS_AVAILABLE)) return 1;
  if (!decided.has(APPROVAL_LEVELS.AAO_RELEASE)) return 2;
  return null;
}

/**
 * Separation of duties. One person may not both prepare and decide on the same
 * voucher, and may not decide twice (the database also enforces one decision
 * per approver per level).
 */
export function approvalConflict(input: {
  preparedById: number | null;
  createdById?: number | null;
  approverId: number;
  approvals: readonly ApprovalRow[];
}): string | null {
  const preparers = [input.preparedById, input.createdById].filter(
    (value): value is number => typeof value === "number"
  );
  if (preparers.includes(input.approverId)) {
    return "The person who prepared a voucher cannot certify or approve it. Ask another treasurer or the Captain to decide on this voucher.";
  }
  if (input.approvals.some((row) => row.approverId === input.approverId)) {
    return "You already decided on this voucher. A second decision has to come from the other approving role.";
  }
  return null;
}

export function levelForAction(action: DisbursementAction): 1 | 2 | null {
  if (action === "CERTIFY") return APPROVAL_LEVELS.FUNDS_AVAILABLE;
  if (action === "APPROVE") return APPROVAL_LEVELS.AAO_RELEASE;
  return null;
}

export function decisionForAction(
  action: DisbursementAction
): ApprovalDecision | null {
  if (action === "CERTIFY") return "CERTIFIED";
  if (action === "APPROVE") return "APPROVED";
  if (action === "REJECT") return "REJECTED";
  return null;
}

export function statusAfterAction(
  status: string,
  action: DisbursementAction
): DisbursementStatus | null {
  switch (action) {
    case "SUBMIT":
      return status === "DRAFT" ? "SUBMITTED" : null;
    case "CERTIFY":
      return status === "SUBMITTED" ? "CERTIFIED" : null;
    case "APPROVE":
      return status === "CERTIFIED" ? "APPROVED" : null;
    case "REJECT":
      return status === "SUBMITTED" || status === "CERTIFIED"
        ? "REJECTED"
        : null;
    case "RELEASE":
      return status === "APPROVED" ? "RELEASED" : null;
    case "LIQUIDATE":
      return status === "RELEASED" ? "LIQUIDATED" : null;
    case "CANCEL":
      return ["DRAFT", "SUBMITTED", "CERTIFIED", "APPROVED"].includes(status)
        ? "CANCELLED"
        : null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Aging (how long a voucher has been waiting)
// ---------------------------------------------------------------------------

export const AGING_BUCKETS = ["0-7", "8-30", "31-60", "61-90", "90+"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export function ageInDays(from: Date, now: Date = new Date()): number {
  const ms = now.getTime() - from.getTime();
  if (ms <= 0) return 0;
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

export function agingBucket(from: Date, now: Date = new Date()): AgingBucket {
  const days = ageInDays(from, now);
  if (days <= 7) return "0-7";
  if (days <= 30) return "8-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

export function emptyAgingSummary(): Record<
  AgingBucket,
  { count: number; amount: number }
> {
  return AGING_BUCKETS.reduce(
    (acc, bucket) => {
      acc[bucket] = { count: 0, amount: 0 };
      return acc;
    },
    {} as Record<AgingBucket, { count: number; amount: number }>
  );
}

export function agingSummary(
  vouchers: ReadonlyArray<{ submittedAt: Date | null; amount: unknown }>,
  now: Date = new Date()
): Record<AgingBucket, { count: number; amount: number }> {
  const summary = emptyAgingSummary();
  for (const voucher of vouchers) {
    if (!voucher.submittedAt) continue;
    const bucket = agingBucket(voucher.submittedAt, now);
    summary[bucket].count += 1;
    summary[bucket].amount = roundMoney(
      summary[bucket].amount + toMoney(voucher.amount)
    );
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Reference numbers
// ---------------------------------------------------------------------------

function pad(value: number, width: number): string {
  return String(Math.max(0, Math.trunc(value))).padStart(width, "0");
}

/** Disbursement vouchers: `DV-2026-10-0007` (year, month, running number). */
export function voucherNumber(
  year: number,
  month: number,
  sequence: number
): string {
  return `DV-${pad(year, 4)}-${pad(month, 2)}-${pad(sequence, 4)}`;
}

/** Earmarks: `EM-2026-0007`. */
export function earmarkCode(year: number, sequence: number): string {
  return `EM-${pad(year, 4)}-${pad(sequence, 4)}`;
}
