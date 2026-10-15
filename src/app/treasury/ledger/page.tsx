import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LedgerTable } from "@/components/treasury/ledger-table";
import { PageHeader } from "@/components/ui/page-header";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";
import { ledgerRegister, listAllocations } from "@/lib/treasury/query";

export const metadata: Metadata = {
  title: "Ledger",
};

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ allocationId?: string; paidOut?: string }>;
};

/**
 * The append-only ledger register. A correction is never an edit — it is a new
 * entry with a memo, which is why the history can be trusted.
 */
export default async function TreasuryLedgerPage({ searchParams }: PageProps) {
  const user = await requirePermission("treasury.balance.view");
  const { allocationId, paidOut } = await searchParams;
  const parsed = Number(allocationId ?? "");
  const selected =
    Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  const moneyOut = paidOut === "1";
  const locale = await getLocale();
  const t = copy[locale].revamp.treasuryDesk;
  const actor = {
    id: user.id,
    roleKey: user.role.key,
    officeId: user.officeId ?? null,
  };

  const [entries, allocations] = await Promise.all([
    ledgerRegister(db, {
      actor,
      allocationId: selected,
      take: 200,
      paidOut: moneyOut,
    }),
    listAllocations(db, { actor }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title={t.ledgerTitle} description={t.ledgerLead} />

      <div className="flex flex-wrap gap-2">
        <Button
          href={moneyOut ? "/treasury/ledger?paidOut=1" : "/treasury/ledger"}
          size="sm"
          variant={selected === null ? "primary" : "outline"}
        >
          {t.ledgerTitle}
        </Button>
        {allocations.map((allocation) => {
          const query = new URLSearchParams();
          query.set("allocationId", String(allocation.id));
          if (moneyOut) query.set("paidOut", "1");
          return (
            <Button
              key={allocation.id}
              href={`/treasury/ledger?${query.toString()}`}
              size="sm"
              variant={selected === allocation.id ? "primary" : "outline"}
            >
              {allocation.coaCode}
            </Button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          href={selected ? `/treasury/ledger?allocationId=${selected}` : "/treasury/ledger"}
          size="sm"
          variant={!moneyOut ? "primary" : "outline"}
        >
          {t.ledgerFilterAll}
        </Button>
        <Button
          href={
            selected
              ? `/treasury/ledger?allocationId=${selected}&paidOut=1`
              : "/treasury/ledger?paidOut=1"
          }
          size="sm"
          variant={moneyOut ? "primary" : "outline"}
        >
          {t.ledgerFilterPaidOut}
        </Button>
      </div>

      <Card>
        <LedgerTable entries={entries} locale={locale} showAllocation />
      </Card>
    </div>
  );
}
