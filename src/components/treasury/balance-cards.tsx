import { Card } from "@/components/ui/card";
import { formatPeso } from "@/lib/cases/manpower";
import { copy, type Locale } from "@/lib/i18n";
import type { TreasuryDashboard } from "@/lib/treasury/query";

/**
 * The four live figures a treasurer checks first, plus the queue sizes that
 * explain them. Every number comes from the ledger, never from a typed-in
 * field.
 */
export function BalanceCards({
  totals,
  locale = "en",
}: {
  totals: TreasuryDashboard["totals"];
  locale?: Locale;
}) {
  const t = copy[locale].revamp.treasuryDesk;

  const cards = [
    {
      label: t.appropriated,
      value: totals.appropriated,
      className: "text-ink",
    },
    { label: t.reserved, value: totals.reserved, className: "text-amber-700" },
    {
      label: t.disbursed,
      value: totals.disbursed,
      className: "text-ink-muted",
    },
    {
      label: t.available,
      value: totals.available,
      className: "text-emerald-700",
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.label}>
          <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
            {card.label}
          </p>
          <p className={`mt-1 text-2xl font-bold ${card.className}`}>
            {formatPeso(card.value)}
          </p>
        </Card>
      ))}
      <div className="sm:col-span-2 lg:col-span-4">
        <p className="text-xs text-ink-subtle">
          {t.allocationsLabel}: {totals.allocations}
        </p>
      </div>
    </div>
  );
}
