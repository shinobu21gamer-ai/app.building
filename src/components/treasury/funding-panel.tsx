import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatPeso } from "@/lib/cases/manpower";
import { formatDateTime } from "@/lib/format";
import { copy, type Locale } from "@/lib/i18n";
import { covers } from "@/lib/treasury/approval";
import type { caseFundingView } from "@/lib/treasury/query";

type Funding = Awaited<ReturnType<typeof caseFundingView>>;

/**
 * What the treasury has set aside for one case, and what has already been paid.
 * This is the panel that turns the AWAITING_BUDGET stage from a mystery into a
 * figure the official can point at.
 *
 * It also says what happens next. A case sitting in AWAITING_BUDGET used to show
 * one sentence — "no approved earmark is set aside yet" — which tells the
 * official they are stuck without telling them what is missing, how much, or
 * whose desk it is on. So the panel now states the estimate, the amount set
 * aside, the exact shortfall, whether a proposal is already waiting on the
 * Captain, and — for a reader who can propose an earmark — a button that opens
 * the treasury's form with this case and this shortfall already filled in.
 */
export function FundingPanel({
  funding,
  concernId,
  estimate = null,
  canPrepareEarmark = false,
  locale = "en",
}: {
  funding: Funding;
  /** The case, so the treasury form can be opened on it. */
  concernId: number;
  /** The saved cost estimate; null when the assessment has none yet. */
  estimate?: number | null;
  /** Whether this reader may propose an earmark (the treasurer, an admin). */
  canPrepareEarmark?: boolean;
  locale?: Locale;
}) {
  const t = copy[locale].revamp.treasuryDesk;

  const setAside = funding.gate.total;
  const shortfall =
    estimate === null ? 0 : Math.max(0, Math.round((estimate - setAside) * 100) / 100);
  const funded = estimate !== null && covers(estimate, setAside);
  // Money already proposed but not yet approved: the case is waiting on a
  // decision, not on somebody noticing it.
  const proposed = funding.earmarks.filter(
    (earmark) => earmark.status === "PROPOSED"
  );
  const proposedTotal = proposed.reduce(
    (sum, earmark) => sum + earmark.amount,
    0
  );

  const nextStep =
    estimate === null
      ? t.fundingNoEstimate
      : funded
        ? t.fundingFullySetAside
        : setAside === 0
          ? t.fundingNothingSetAside.replace(
              "{shortfall}",
              formatPeso(shortfall)
            )
          : t.fundingNeedsMore.replace("{shortfall}", formatPeso(shortfall));

  return (
    <div className="space-y-3">
      <p
        className={
          funding.gate.certified
            ? "rounded-control border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
            : "rounded-control border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
        }
      >
        {funding.gate.message}
      </p>

      {funding.budgetDecision !== null && proposed.length === 0 && (
        <p className="rounded-control border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <span className="font-semibold">{t.fundingNotFund}</span>
          {funding.budgetDecision.reason}
          <span className="block text-xs">
            {t.fundingNotFundBy.replaceAll(
              "{name}",
              funding.budgetDecision.decidedByName ?? "—"
            )}{" "}
            {formatDateTime(funding.budgetDecision.decidedAt)}
          </span>
        </p>
      )}

      <div className="flex flex-wrap gap-3 text-sm">
        <span className="text-ink-muted">
          {t.fundingPaid}:{" "}
          <span className="font-semibold tabular-nums">
            {formatPeso(funding.paid)}
          </span>
        </span>
        <span className="text-ink-muted">
          {t.fundingCommitted}:{" "}
          <span className="font-semibold tabular-nums">
            {formatPeso(funding.committed)}
          </span>
        </span>
      </div>

      {/* The money maths, so "how much more?" is read here and not guessed. */}
      {estimate !== null && (
        <dl className="divide-y divide-line rounded-control border border-line bg-surface-sunken/60 px-3">
          <div className="flex items-baseline justify-between gap-3 py-1.5">
            <dt className="text-sm text-ink-muted">
              {t.earmarkReview.estimate}
            </dt>
            <dd className="text-sm font-semibold tabular-nums text-ink">
              {formatPeso(estimate)}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 py-1.5">
            <dt className="text-sm text-ink-muted">
              {t.earmarkReview.setAsideNow}
            </dt>
            <dd className="text-sm font-semibold tabular-nums text-ink">
              {formatPeso(setAside)}
            </dd>
          </div>
          {!funded && (
            <div className="flex items-baseline justify-between gap-3 py-1.5">
              <dt className="text-sm text-ink-muted">{t.fundingStillNeeded}</dt>
              <dd className="text-sm font-semibold tabular-nums text-amber-700">
                {formatPeso(shortfall)}
              </dd>
            </div>
          )}
        </dl>
      )}

      {/* What happens next, and the shortcut for the reader who can act on it. */}
      <div className="space-y-2 rounded-control border border-line px-3 py-2.5">
        <p className="text-caption font-semibold uppercase tracking-wide text-ink-subtle">
          {t.fundingWhatNext}
        </p>
        <p className="text-sm text-ink-muted">{nextStep}</p>
        {proposed.length > 0 && !funded && (
          <p className="text-sm text-ink-muted">
            {t.earmarkWaitingOnCaptain}:{" "}
            <span className="font-semibold tabular-nums">
              {formatPeso(proposedTotal)}
            </span>{" "}
            ({proposed.map((earmark) => earmark.code ?? `#${earmark.earmarkId}`).join(", ")})
          </p>
        )}
        {canPrepareEarmark && !funded && shortfall > 0 && (
          <Button
            href={`/treasury/fund?concernId=${concernId}`}
            size="sm"
            variant="outline"
          >
            {t.fundingProposeShortfall.replace(
              "{shortfall}",
              formatPeso(shortfall)
            )}
          </Button>
        )}
      </div>

      {funding.earmarks.length > 0 && (
        <ul className="divide-y divide-line">
          {funding.earmarks.map((earmark) => (
            <li key={earmark.earmarkId} className="py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-ink-subtle">
                  {earmark.code ?? `#${earmark.earmarkId}`}
                </span>
                <Badge
                  tone={
                    earmark.status === "APPROVED"
                      ? "amber"
                      : earmark.status === "RELEASED"
                        ? "green"
                        : "gray"
                  }
                >
                  {earmark.status}
                </Badge>
                <span className="text-sm font-semibold text-ink">
                  {formatPeso(earmark.amount)}
                </span>
              </div>
              <p className="text-sm text-ink-muted">{earmark.purpose}</p>
              <p className="text-xs text-ink-subtle">
                {earmark.coaCode} · {earmark.fundSource}
                {earmark.approvedAt
                  ? ` · ${formatDateTime(earmark.approvedAt)}`
                  : ""}
              </p>
            </li>
          ))}
        </ul>
      )}

      {funding.disbursements.length > 0 && (
        <ul className="divide-y divide-line">
          {funding.disbursements.map((voucher) => (
            <li
              key={voucher.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2"
            >
              <span className="text-sm text-ink-muted">
                {voucher.voucherNumber ?? `#${voucher.id}`} · {voucher.payee} ·{" "}
                {formatPeso(voucher.amount)}
              </span>
              <span className="flex items-center gap-2">
                <Badge
                  tone={
                    voucher.status === "RELEASED" ||
                    voucher.status === "LIQUIDATED"
                      ? "green"
                      : voucher.status === "REJECTED" ||
                          voucher.status === "CANCELLED"
                        ? "red"
                        : "sky"
                  }
                >
                  {voucher.statusLabel}
                </Badge>
                <Button
                  href={`/treasury/disbursements/${voucher.id}`}
                  size="sm"
                  variant="ghost"
                >
                  {t.open}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
