import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatPeso } from "@/lib/cases/manpower";
import { formatDateTime } from "@/lib/format";
import { copy, type Locale } from "@/lib/i18n";
import type { caseFundingView } from "@/lib/treasury/query";

type Funding = Awaited<ReturnType<typeof caseFundingView>>;

/**
 * What the treasury has set aside for one case, and what has already been paid.
 * This is the panel that turns the AWAITING_BUDGET stage from a mystery into a
 * figure the official can point at.
 */
export function FundingPanel({
  funding,
  locale = "en",
}: {
  funding: Funding;
  locale?: Locale;
}) {
  const t = copy[locale].revamp.treasuryDesk;

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
