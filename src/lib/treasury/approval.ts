// The earmark approval brief.
//
// Approving an earmark is the decision that lets a resident's case leave
// AWAITING_BUDGET, and it used to be made from four numbers on a card: a code,
// an amount, a purpose and a COA code. Nothing tied the money to the concern it
// was for, so "am I approving the right fund for the right case?" had no answer
// on screen — and the two ways an approval can fail (the reader proposed it
// themselves, or the allocation cannot cover it) were only discovered after the
// button was pressed, which left the earmark PROPOSED and the case stuck.
//
// This module computes, from facts alone, everything an approver has to see
// BEFORE deciding:
//
//   * what the case needs, what is already set aside and what this earmark
//     changes (does approving it unblock the case, or leave it short?);
//   * whether the source allocation can actually cover the amount, and what is
//     left afterwards;
//   * whether this reader is allowed to decide at all, and if not, why and who
//     can.
//
// Pure: no database, no framework imports, and it never writes prose. It returns
// codes; the screens turn them into sentences through `copy` (the same split as
// `caseProcessFlow` and its `blocks` table).

/** Matches `MONEY_EPSILON` in `cases/process-flow.ts` and `budgetStageBlock`. */
export const MONEY_EPSILON = 0.005;

/** The permission that decides an earmark (held by the Captain and the Admin). */
export const EARMARK_APPROVE_PERMISSION = "treasury.earmark.approve" as const;

/**
 * What approving this earmark would do for the linked case.
 *
 * NO_CASE      — not linked to a concern: it funds a purpose, not a case.
 * NO_ESTIMATE  — linked, but the case has no saved cost estimate, so there is
 *                nothing to compare the amount against.
 * UNBLOCKS     — the case is waiting in AWAITING_BUDGET and this approval covers
 *                its estimate: the case can move to In progress.
 * COVERS       — covers the estimate for a case that is not (or no longer)
 *                waiting on this money.
 * PART_FUNDS   — still short of the estimate after this approval.
 * OVER_FUNDS   — sets aside more than the estimate.
 */
export type EarmarkFundingVerdict =
  | "NO_CASE"
  | "NO_ESTIMATE"
  | "UNBLOCKS"
  | "COVERS"
  | "PART_FUNDS"
  | "OVER_FUNDS";

/**
 * Why this reader cannot decide on this earmark right now, or null when they
 * can. These mirror the two rejections `approveEarmark` enforces, plus the
 * status and permission checks the route does — surfaced up front instead of as
 * a failed request.
 *
 * SELF_PREPARED  — segregation of duties: the preparer may not approve. This is
 *                  the dead end that leaves a case in AWAITING_BUDGET, because
 *                  an administrator holds both permissions and so used to see an
 *                  Approve button that could only ever fail.
 * OVER_AVAILABLE — the allocation cannot cover the amount; approving would be
 *                  rejected by the ledger check.
 * NOT_PROPOSED   — already approved, released or cancelled.
 * NO_PERMISSION  — this role does not hold `treasury.earmark.approve`.
 */
export type EarmarkBlockReason =
  | "SELF_PREPARED"
  | "OVER_AVAILABLE"
  | "NOT_PROPOSED"
  | "NO_PERMISSION";

export type EarmarkApprovalInput = {
  amount: number;
  status: string;
  /**
   * Live available balance of the allocation the earmark draws on. Null when the
   * caller did not load it: the brief then refuses to claim the amount does not
   * fit, because an unknown balance is not an empty one.
   */
  allocationAvailable: number | null;
  /** Who proposed it; null on a legacy row with no recorded preparer. */
  preparedById: number | null;
  /** The user reading the screen. */
  actorId: number;
  /** Whether that user holds `treasury.earmark.approve`. */
  canApprove: boolean;
  /** The linked case's saved cost estimate; null when unlinked or unestimated. */
  caseEstimate: number | null;
  /**
   * Approved/released earmarks already set aside for that case, EXCLUDING this
   * one. The brief is about what this approval *adds*, so the row's own amount
   * is never counted twice here. Null (nothing loaded, or no linked case) reads
   * as nothing set aside yet.
   */
  caseSetAside: number | null;
  /** The linked case's status; null when the earmark funds a purpose only. */
  caseStatus: string | null;
};

export type EarmarkApprovalBrief = {
  /** The amount this earmark would reserve. */
  amount: number;
  // ---- the source allocation ----
  /** False when the caller never loaded the balance; the figures are then null. */
  balanceKnown: boolean;
  /** Available before this approval. */
  availableBefore: number | null;
  /** Available after it, when it fits; the unchanged figure when it does not. */
  availableAfter: number | null;
  /** The allocation can cover the amount (assumed true when the balance is unknown). */
  fits: boolean;
  // ---- the linked case ----
  /** Linked to a resident concern at all. */
  hasCase: boolean;
  /** The case is sitting in AWAITING_BUDGET, waiting on exactly this money. */
  caseWaitingForBudget: boolean;
  caseEstimate: number | null;
  /** Set aside before this earmark. */
  setAsideBefore: number;
  /** Set aside once this earmark is approved. */
  setAsideAfter: number;
  /** Still needed after this approval; 0 when the estimate is covered. */
  shortfallAfter: number;
  /** Set aside beyond the estimate; 0 when it is not over. */
  excessOverEstimate: number;
  /** The estimate is fully covered once this is approved. */
  coversEstimate: boolean;
  verdict: EarmarkFundingVerdict;
  // ---- can this reader decide? ----
  /** The reader is the one who proposed it (segregation of duties). */
  selfPrepared: boolean;
  /** Null when the reader may approve right now. */
  blockReason: EarmarkBlockReason | null;
  /** True only when the Approve button should be offered. */
  canDecide: boolean;
};

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

/** True when `have` covers `need` within the rounding tolerance. */
export function covers(need: number, have: number): boolean {
  return have + MONEY_EPSILON >= need;
}

/**
 * The brief for one earmark, as seen by one reader.
 *
 * The verdict and the block reason are computed independently: an earmark can
 * be exactly right for the case and still be one this reader may not approve,
 * and the screen has to say both.
 */
export function earmarkApprovalBrief(
  input: EarmarkApprovalInput
): EarmarkApprovalBrief {
  const amount = money(input.amount);
  const availableBefore =
    input.allocationAvailable === null
      ? null
      : money(input.allocationAvailable);
  const balanceKnown = availableBefore !== null;
  const fits = availableBefore === null || covers(amount, availableBefore);
  const availableAfter =
    availableBefore === null
      ? null
      : fits
        ? money(availableBefore - amount)
        : availableBefore;

  const hasCase = input.caseStatus !== null || input.caseEstimate !== null;
  const caseWaitingForBudget = input.caseStatus === "AWAITING_BUDGET";
  const setAsideBefore = money(input.caseSetAside ?? 0);
  const setAsideAfter = money(setAsideBefore + amount);

  const estimate = input.caseEstimate;
  const shortfallAfter =
    estimate === null ? 0 : money(Math.max(0, estimate - setAsideAfter));
  const excessOverEstimate =
    estimate === null ? 0 : money(Math.max(0, setAsideAfter - estimate));
  const coversEstimate = estimate !== null && shortfallAfter <= MONEY_EPSILON;

  const verdict: EarmarkFundingVerdict = (() => {
    if (!hasCase) return "NO_CASE";
    if (estimate === null) return "NO_ESTIMATE";
    if (excessOverEstimate > MONEY_EPSILON) return "OVER_FUNDS";
    if (!coversEstimate) return "PART_FUNDS";
    return caseWaitingForBudget ? "UNBLOCKS" : "COVERS";
  })();

  const selfPrepared =
    input.preparedById !== null && input.preparedById === input.actorId;
  const isProposed = input.status === "PROPOSED";

  // Order matters: the reason shown is the first thing standing in the way, and
  // "this is not yours to decide" beats "it does not fit" because acting on the
  // second would not help.
  const blockReason: EarmarkBlockReason | null = !isProposed
    ? "NOT_PROPOSED"
    : !input.canApprove
      ? "NO_PERMISSION"
      : selfPrepared
        ? "SELF_PREPARED"
        : !fits
          ? "OVER_AVAILABLE"
          : null;

  return {
    amount,
    balanceKnown,
    availableBefore,
    availableAfter,
    fits,
    hasCase,
    caseWaitingForBudget,
    caseEstimate: estimate === null ? null : money(estimate),
    setAsideBefore,
    setAsideAfter,
    shortfallAfter,
    excessOverEstimate,
    coversEstimate,
    verdict,
    selfPrepared,
    blockReason,
    canDecide: blockReason === null,
  };
}

/**
 * The per-row facts `listEarmarks` carries. Declared structurally so this module
 * never imports the Prisma-dependent read layer — the row is assignable by
 * shape, and the adapter below is the only place the two meet.
 */
export type EarmarkRowFacts = {
  amount: number;
  status: string;
  preparedById: number | null;
  allocationAvailable: number | null;
  caseEstimate: number | null;
  caseSetAside: number | null;
  caseStatus: string | null;
};

/** The brief for one earmark register row, as seen by one reader. */
export function briefForEarmarkRow(
  row: EarmarkRowFacts,
  viewer: { id: number; canApprove: boolean }
): EarmarkApprovalBrief {
  return earmarkApprovalBrief({
    amount: row.amount,
    status: row.status,
    allocationAvailable: row.allocationAvailable,
    preparedById: row.preparedById,
    actorId: viewer.id,
    canApprove: viewer.canApprove,
    caseEstimate: row.caseEstimate,
    caseSetAside: row.caseSetAside,
    caseStatus: row.caseStatus,
  });
}

/** Earmark statuses that actually reserve money against a case. */
export const SET_ASIDE_STATUSES = ["APPROVED", "RELEASED"] as const;

/**
 * How much is already set aside for a case BEFORE this earmark, given the total
 * of every approved/released earmark on that case.
 *
 * A row that is itself approved or released is already inside that total, so
 * adding it again would report double the money and tell an approver a case is
 * funded when it is not. A proposed row is not in the total, so nothing is
 * subtracted. This is the one piece of money arithmetic the brief depends on
 * that the read layer cannot compute for itself, so it lives here and is tested.
 */
export function setAsideBeforeThis(input: {
  /** Sum of every APPROVED/RELEASED earmark on the case, this row included. */
  concernTotal: number;
  thisAmount: number;
  thisStatus: string;
}): number {
  const counts = (SET_ASIDE_STATUSES as readonly string[]).includes(
    input.thisStatus
  );
  const before = counts
    ? input.concernTotal - input.thisAmount
    : input.concernTotal;
  // Never report a negative set-aside: a cancelled or amended row could leave
  // the total smaller than this earmark, and "₱-5,000 already set aside" is not
  // a figure anyone can act on.
  return money(Math.max(0, before));
}

/**
 * Whether an earmark belongs in the "needs a decision" queue: it is still
 * PROPOSED and somebody has to act on it. Kept here so the register, the
 * Captain's desk and the dashboard count the same set.
 */
export function isAwaitingDecision(status: string): boolean {
  return status === "PROPOSED";
}

/**
 * Orders an earmark queue the way the desk works it: what still needs a decision
 * first, then what the reader can decide themselves ahead of what is waiting on
 * somebody else, and inside that a case sitting in AWAITING_BUDGET outranks the
 * rest — that is the case a resident is waiting on.
 *
 * Tie-break on `preparedAt` ascending (the longest-queued proposal first); the
 * caller owns that half of the comparison.
 */
export function earmarkQueueRank(input: {
  status: string;
  canDecide: boolean;
  caseWaitingForBudget: boolean;
}): number {
  const settled = isAwaitingDecision(input.status) ? 0 : 1;
  const decidable = input.canDecide ? 0 : 1;
  const waiting = input.caseWaitingForBudget ? 0 : 1;
  return settled * 100 + decidable * 10 + waiting;
}
