import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  CheckCircle2,
  MinusCircle,
  XCircle,
} from "lucide-react";
import { formatPeso } from "@/lib/cases/manpower";
import { statusLabel } from "@/lib/cases/workflow";
import { formatDateTime } from "@/lib/format";
import { copy, type Locale } from "@/lib/i18n";
import type { EarmarkApprovalBrief } from "@/lib/treasury/approval";
// Type-only: erased at build time, so this component never pulls the
// Prisma-dependent read layer into a bundle.
import type { EarmarkRow } from "@/lib/treasury/query";

/**
 * The earmark facts this panel reads. Declared here rather than importing
 * `EarmarkRow` so the panel stays presentational and both approval screens can
 * hand it the row they already loaded.
 */
export type EarmarkReviewFacts = {
  id: number;
  code: string | null;
  purpose: string;
  /** PROPOSED | APPROVED | RELEASED | CANCELLED — decides how the panel reads. */
  status: string;
  amount: number;
  allocationLabel: string;
  coaCode: string;
  coaName: string;
  fundSourceCode: string;
  fundSourceName: string;
  fiscalYear: number;
  officeName: string | null;
  concernId: number | null;
  caseNumber: string | null;
  caseTitle: string | null;
  caseStatus: string | null;
  caseOfficeName: string | null;
  preparedByName: string | null;
  preparedByRole: string | null;
  preparedAt: Date;
  approvedByName: string | null;
};

/**
 * Narrows a register row to what the panel displays. Every approval screen loads
 * `EarmarkRow`, so keeping the mapping here is what stops three pages drifting
 * apart on which facts an approver gets to see.
 */
export function earmarkReviewFacts(row: EarmarkRow): EarmarkReviewFacts {
  return {
    id: row.id,
    code: row.code,
    purpose: row.purpose,
    status: row.status,
    amount: row.amount,
    allocationLabel: row.allocationLabel,
    coaCode: row.coaCode,
    coaName: row.coaName,
    fundSourceCode: row.fundSourceCode,
    fundSourceName: row.fundSourceName,
    fiscalYear: row.fiscalYear,
    officeName: row.officeName,
    concernId: row.concernId,
    caseNumber: row.caseNumber,
    caseTitle: row.caseTitle,
    caseStatus: row.caseStatus,
    caseOfficeName: row.caseOfficeName,
    preparedByName: row.preparedByName,
    preparedByRole: row.preparedByRole,
    preparedAt: row.preparedAt,
    approvedByName: row.approvedByName,
  };
}

/** The statuses an earmark can be settled in, i.e. already decided. */
const SETTLED_STATUSES = ["APPROVED", "RELEASED", "CANCELLED"] as const;
type SettledStatus = (typeof SETTLED_STATUSES)[number];

/**
 * Narrows a stored status to one the settled copy covers. The database column is
 * a plain string, so this is what keeps `t.settled[...]` indexed by a key that
 * is known to exist rather than by whatever the row happens to hold.
 */
function settledStatus(status: string): SettledStatus | null {
  return (SETTLED_STATUSES as readonly string[]).includes(status)
    ? (status as SettledStatus)
    : null;
}

function roleName(
  roleKey: string | null,
  names: { readonly [key: string]: string },
  fallback: string
): string {
  if (roleKey === null) return fallback;
  return names[roleKey] ?? roleKey;
}

/** One labelled figure in the money column. */
function Figure({
  label,
  value,
  tone = "text-ink",
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-sm text-ink-muted">{label}</span>
      <span className={`text-sm font-semibold tabular-nums ${tone}`}>{value}</span>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-caption font-semibold uppercase tracking-wide text-ink-subtle">
      {children}
    </p>
  );
}

/** The four ways a check can read. */
type ChecklistState = "pass" | "warn" | "fail" | "unknown";

/**
 * One tick of the three-check summary: pass (green tick), warn (amber
 * triangle) or fail (red cross). "unknown" reads neutral — a fact that was
 * not loaded is not a failed check, and pretending it is one would teach the
 * reader to ignore red.
 */
function ChecklistItem({
  state,
  label,
}: {
  state: ChecklistState;
  label: string;
}) {
  const tone = {
    pass: "border-emerald-200 bg-emerald-50 text-emerald-800",
    warn: "border-amber-200 bg-amber-50 text-amber-800",
    fail: "border-red-200 bg-red-50 text-red-800",
    unknown: "border-line bg-surface text-ink-muted",
  }[state];
  const icon = {
    pass: <CheckCircle2 size={14} aria-hidden="true" />,
    warn: <AlertTriangle size={14} aria-hidden="true" />,
    fail: <XCircle size={14} aria-hidden="true" />,
    unknown: <MinusCircle size={14} aria-hidden="true" />,
  }[state];
  return (
    <li
      className={`flex items-center gap-1.5 rounded-control border px-2.5 py-1.5 text-xs font-medium ${tone}`}
    >
      {icon}
      <span>{label}</span>
    </li>
  );
}

/**
 * The approval brief: one earmark read against the resident concern it is for
 * and the budget it comes out of.
 *
 * This is the answer to "how do I know I am approving the right money for the
 * right case?". Before it existed the approver saw a code, an amount, a purpose
 * and two accounting codes — nothing that connected the money to the concern,
 * nothing that said whether approving it would actually let the case leave
 * Awaiting budget, and nothing that warned that the reader was the one who
 * proposed it and therefore could not decide. Every one of those is a fact the
 * treasury already held; `earmarkApprovalBrief` turns them into this panel.
 *
 * The verdict and the block reason are both always shown: an earmark can be
 * exactly right for the case and still be one this reader may not approve.
 */
export function EarmarkReview({
  earmark,
  brief,
  locale = "en",
  compact = false,
}: {
  earmark: EarmarkReviewFacts;
  brief: EarmarkApprovalBrief;
  locale?: Locale;
  /** Tighter spacing for the Captain's queue, where each row is one line up. */
  compact?: boolean;
}) {
  const t = copy[locale].revamp.treasuryDesk.earmarkReview;
  const desk = copy[locale].revamp.treasuryDesk;
  const caseName = earmark.caseNumber ?? `#${earmark.concernId ?? earmark.id}`;
  const caseSuffix =
    earmark.concernId === null
      ? ""
      : t.caseSuffix.replaceAll("{case}", caseName);
  // An earmark that has already been decided reads differently: there is no
  // approval left to happen, so the figures are stated as they stand.
  const decided = brief.blockReason === "NOT_PROPOSED";

  const verdict = t.verdicts[brief.verdict]
    .replaceAll("{case}", caseName)
    .replaceAll("{shortfall}", formatPeso(brief.shortfallAfter))
    .replaceAll("{excess}", formatPeso(brief.excessOverEstimate));

  const settledKey = settledStatus(earmark.status);
  const settledNote =
    settledKey === null
      ? null
      : t.settled[settledKey]
          .replaceAll("{amount}", formatPeso(brief.amount))
          .replaceAll("{caseSuffix}", caseSuffix);

  const block =
    brief.blockReason === null || brief.blockReason === "NOT_PROPOSED"
      ? null
      : t.blocks[brief.blockReason]
          .replaceAll("{desk}", t.approverDesk)
          .replaceAll("{amount}", formatPeso(brief.amount))
          .replaceAll(
            "{available}",
            brief.availableBefore === null
              ? t.balanceUnknown
              : formatPeso(brief.availableBefore)
          );

  // The three-check summary, read off the same brief as the figures below it:
  // right case, budget covers it, proposed by someone else. An earmark that has
  // already been decided has no approval left to summarise.
  const coversCase =
    brief.verdict === "UNBLOCKS" || brief.verdict === "COVERS";
  const checks: Array<{ state: ChecklistState; label: string }> = decided
    ? []
    : [
        {
          state: !brief.hasCase ? "fail" : coversCase ? "pass" : "warn",
          label: !brief.hasCase
            ? t.checklist.caseCheck.fail
            : coversCase
              ? t.checklist.caseCheck.pass
              : t.checklist.caseCheck.warn,
        },
        {
          state: !brief.balanceKnown ? "unknown" : brief.fits ? "pass" : "fail",
          label: !brief.balanceKnown
            ? t.checklist.fundsCheck.unknown
            : brief.fits
              ? t.checklist.fundsCheck.pass
              : t.checklist.fundsCheck.fail,
        },
        {
          state: brief.selfPrepared ? "warn" : "pass",
          label: brief.selfPrepared
            ? t.checklist.proposerCheck.warn
            : t.checklist.proposerCheck.pass,
        },
      ];

  // Red is reserved for "the money is not there". Being told somebody else
  // decides is a routing fact, not an error, so it reads amber; a proposal that
  // does exactly what the case needs reads green.
  const verdictTone = (() => {
    if (brief.blockReason === "OVER_AVAILABLE") {
      return "border-red-200 bg-red-50 text-red-800";
    }
    if (
      brief.blockReason === "SELF_PREPARED" ||
      brief.blockReason === "NO_PERMISSION"
    ) {
      return "border-amber-200 bg-amber-50 text-amber-800";
    }
    if (brief.blockReason === null) {
      if (brief.verdict === "UNBLOCKS" || brief.verdict === "COVERS") {
        return "border-emerald-200 bg-emerald-50 text-emerald-800";
      }
      if (
        brief.verdict === "PART_FUNDS" ||
        brief.verdict === "OVER_FUNDS" ||
        brief.verdict === "NO_ESTIMATE"
      ) {
        return "border-amber-200 bg-amber-50 text-amber-800";
      }
    }
    return "border-line bg-surface-sunken text-ink-muted";
  })();

  return (
    <div
      className={`rounded-control border border-line bg-surface-sunken/60 ${
        compact ? "space-y-3 p-3" : "space-y-4 p-4"
      }`}
    >
      <p className="text-caption font-semibold uppercase tracking-wide text-ink-subtle">
        {t.title}
      </p>

      {/* ── 0. The three-question summary, before the figures ──
          The brief below answers everything, but it is a lot to check at a
          glance. This strip answers "am I good to approve?" in three ticks;
          anything that is not a tick says which figure below explains it. */}
      {checks.length > 0 && (
        <ul className="grid gap-1.5 sm:grid-cols-3">
          {checks.map((check) => (
            <ChecklistItem
              key={check.label}
              state={check.state}
              label={check.label}
            />
          ))}
        </ul>
      )}

      {/* ── 1. Which resident concern this money is for ── */}
      <div className="space-y-1.5">
        <SectionTitle>{t.caseSection}</SectionTitle>
        {earmark.concernId === null ? (
          <p className="text-sm text-ink-muted">{t.caseNotLinked}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-semibold text-ink">
                {earmark.caseNumber}
              </span>
              {earmark.caseStatus && (
                <StatusBadge
                  status={earmark.caseStatus}
                  label={statusLabel(earmark.caseStatus)}
                />
              )}
              {brief.caseWaitingForBudget && (
                <Badge tone="amber">{desk.caseWaitingForBudget}</Badge>
              )}
            </div>
            <p className="text-sm text-ink">{earmark.caseTitle}</p>
            <div className="flex flex-wrap items-center gap-2 text-xs text-ink-subtle">
              {earmark.caseOfficeName && (
                <span>
                  {t.caseOffice}: {earmark.caseOfficeName}
                </span>
              )}
              <Button
                href={`/official/concerns/${earmark.concernId}`}
                size="sm"
                variant="ghost"
              >
                {t.openCase}
              </Button>
            </div>
          </>
        )}
      </div>

      {/* ── 2. Whether the amount matches what that concern needs ── */}
      <div className="space-y-1">
        <SectionTitle>{t.moneySection}</SectionTitle>
        <div className="divide-y divide-line">
          <Figure
            label={t.estimate}
            value={
              brief.caseEstimate === null
                ? `— (${desk.caseNoEstimate})`
                : formatPeso(brief.caseEstimate)
            }
          />
          <Figure
            label={t.setAsideBefore}
            value={formatPeso(brief.setAsideBefore)}
          />
          <Figure label={t.thisEarmark} value={formatPeso(brief.amount)} />
          <Figure
            label={decided ? t.setAsideNow : t.setAsideAfter}
            value={formatPeso(brief.setAsideAfter)}
            tone="text-ink"
          />
          {brief.shortfallAfter > 0 && (
            <Figure
              label={decided ? t.shortfallNow : t.shortfall}
              value={formatPeso(brief.shortfallAfter)}
              tone="text-amber-700"
            />
          )}
          {brief.excessOverEstimate > 0 && (
            <Figure
              label={t.excess}
              value={formatPeso(brief.excessOverEstimate)}
              tone="text-amber-700"
            />
          )}
        </div>
      </div>

      {/* ── 3. Which budget it comes out of, and what is left afterwards ── */}
      <div className="space-y-1">
        <SectionTitle>{t.sourceSection}</SectionTitle>
        <p className="text-sm text-ink">
          {earmark.allocationLabel}
          <span className="block text-xs text-ink-subtle">
            {earmark.coaCode} — {earmark.coaName} · {earmark.fundSourceCode} —{" "}
            {earmark.fundSourceName} · FY {earmark.fiscalYear}
            {earmark.officeName ? ` · ${earmark.officeName}` : ""}
          </span>
        </p>
        <div className="divide-y divide-line">
          <Figure
            label={t.availableBefore}
            value={
              brief.balanceKnown
                ? formatPeso(brief.availableBefore)
                : t.balanceUnknown
            }
          />
          <Figure
            label={decided ? t.availableUnchanged : t.availableAfter}
            value={
              brief.balanceKnown
                ? formatPeso(brief.availableAfter)
                : t.balanceUnknown
            }
            tone={brief.fits ? "text-emerald-700" : "text-red-600"}
          />
        </div>
      </div>

      {/* ── 4. Who proposed it, so the approver knows whose word this is ── */}
      <p className="text-xs text-ink-subtle">
        {t.preparedBy}:{" "}
        <span className="font-medium text-ink-muted">
          {earmark.preparedByName ?? t.unrecorded}
        </span>{" "}
        ({roleName(earmark.preparedByRole, t.roleNames, t.unrecorded)}) ·{" "}
        {formatDateTime(earmark.preparedAt)}
        {earmark.approvedByName
          ? ` · ${t.approvedBy}: ${earmark.approvedByName}`
          : ""}
      </p>

      {/* ── the answer ── */}
      <div className="space-y-2">
        <p className={`rounded-control border px-3 py-2 text-sm ${verdictTone}`}>
          {block ?? (decided ? (settledNote ?? verdict) : verdict)}
        </p>
        {/* A block still has to say what the money would do for the case: the
            reader needs both facts, not just the reason they cannot act. */}
        {block !== null && (
          <p className="text-xs text-ink-subtle">{verdict}</p>
        )}
      </div>

      {earmark.status === "APPROVED" && (
        <div className="space-y-2 rounded-control border border-brand-100 bg-brand-50 px-3 py-2.5">
          {brief.balanceKnown && brief.availableAfter <= 0.005 && (
            <p className="text-xs leading-relaxed text-brand-900">
              {t.reservedHint}
            </p>
          )}
          <p className="text-caption font-semibold uppercase tracking-wide text-brand-800">
            {t.nextTitle}
          </p>
          <p className="text-sm leading-relaxed text-brand-900">
            {t.nextOfficial}
          </p>
          <p className="text-sm leading-relaxed text-brand-900">{t.nextPay}</p>
          <div className="flex flex-wrap gap-2">
            {earmark.concernId !== null && (
              <Button
                href={`/treasury/disbursements?concernId=${earmark.concernId}&earmarkId=${earmark.id}&pay=CREW`}
                size="sm"
              >
                {t.payCrew}
              </Button>
            )}
            <Button
              href={
                earmark.concernId !== null
                  ? `/treasury/disbursements?concernId=${earmark.concernId}&earmarkId=${earmark.id}`
                  : `/treasury/disbursements?earmarkId=${earmark.id}`
              }
              size="sm"
              variant="outline"
            >
              {t.paySupplier}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
