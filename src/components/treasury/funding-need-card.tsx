import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatPeso } from "@/lib/cases/manpower";
import { copy, type Locale } from "@/lib/i18n";
import type { TreasuryDashboard } from "@/lib/treasury/query";

/**
 * The treasury's answer to "how much money do the cases need?".
 *
 * The pending-queue card counts the cases; a count cannot tell a treasurer
 * whether the barangay is ₱1,500 short or ₱150,000 short, and those are
 * different conversations — one is an earmark, the other is a supplemental
 * appropriation. So the money is stated first, then split into the part a
 * proposal can still find and the part already sitting on the Captain's desk
 * (approving that is not the treasurer's to do), then named case by case.
 *
 * Every figure comes from `fundingQueueSummary`, the same rows the funding
 * desk's cards are built from, so this panel and that page cannot disagree.
 */
export function FundingNeedCard({
  funding,
  locale = "en",
}: {
  funding: TreasuryDashboard["funding"];
  locale?: Locale;
}) {
  const t = copy[locale].revamp.treasuryDesk;
  const { summary, needs } = funding;
  const hidden = Math.max(0, summary.cases - needs.length);

  return (
    <Card
      title={t.fundingNeedTitle}
      description={t.fundingNeedLead}
      actions={
        summary.cases > 0 ? (
          <Button href="/treasury/fund" size="sm">
            {t.navFundCase}
          </Button>
        ) : undefined
      }
    >
      {summary.cases === 0 ? (
        <p className="text-sm text-ink-subtle">{t.fundingNeedNone}</p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-3xl font-bold tabular-nums text-ink">
              {formatPeso(summary.need)}
            </span>
            <span className="text-sm text-ink-subtle">
              {t.fundingNeedTotal.replaceAll("{count}", String(summary.cases))}
            </span>
          </div>

          {/* The split matters: one part is the treasurer's next proposal, the
              other is already out of their hands. */}
          <div className="flex flex-wrap gap-2">
            <Badge tone={summary.toPropose > 0 ? "amber" : "green"}>
              {t.fundingNeedToPropose.replaceAll(
                "{amount}",
                formatPeso(summary.toPropose)
              )}
            </Badge>
            <Badge tone="sky">
              {t.fundingNeedPending.replaceAll(
                "{amount}",
                formatPeso(summary.pending)
              )}
            </Badge>
          </div>

          <ul className="divide-y divide-line border-t border-line">
            {needs.map((row) => (
              <li
                key={row.concernId}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="font-mono text-xs text-ink-subtle">
                    {row.caseNumber}
                  </span>
                  <span className="block truncate text-sm text-ink">
                    {row.title}
                  </span>
                  <span className="block text-xs text-ink-subtle">
                    {row.officeName ?? t.fundCase.noOffice}
                  </span>
                </span>
                <span className="text-right">
                  <span className="block text-sm font-semibold tabular-nums text-ink">
                    {formatPeso(row.need)}
                  </span>
                  {row.pending > 0 && (
                    <span className="block text-xs text-sky-800">
                      {t.fundingNeedPendingPart.replaceAll(
                        "{amount}",
                        formatPeso(row.pending)
                      )}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>

          {hidden > 0 && (
            <p className="text-xs text-ink-subtle">
              {t.fundingNeedMore.replaceAll("{count}", String(hidden))}
            </p>
          )}
        </div>
      )}

      {summary.unestimated > 0 && (
        <p className="mt-3 border-t border-line pt-3 text-xs text-amber-700">
          {t.fundingNeedUnestimated.replaceAll(
            "{count}",
            String(summary.unestimated)
          )}
        </p>
      )}
    </Card>
  );
}
