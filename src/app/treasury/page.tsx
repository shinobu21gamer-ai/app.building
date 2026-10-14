import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BalanceCards } from "@/components/treasury/balance-cards";
import { FundingNeedCard } from "@/components/treasury/funding-need-card";
import { AgingBars, LedgerTable } from "@/components/treasury/ledger-table";
import { PageHeader } from "@/components/ui/page-header";
import { StepGuide } from "@/components/cases/step-guide";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";
import { treasuryDashboard } from "@/lib/treasury/query";
import { formatPeso } from "@/lib/cases/manpower";

export const metadata: Metadata = {
  title: "Treasury",
};

export const dynamic = "force-dynamic";

/**
 * Treasurer dashboard: the four live figures, the queues that explain them, how
 * long the pending vouchers have been waiting, and the tail of the ledger.
 */
export default async function TreasuryDashboardPage() {
  const user = await requirePermission("treasury.balance.view");
  const locale = await getLocale();
  const t = copy[locale].revamp.treasuryDesk;
  const guide = t.guide;

  const dashboard = await treasuryDashboard(db, {
    actor: {
      id: user.id,
      roleKey: user.role.key,
      officeId: user.officeId ?? null,
    },
  });

  const pending: Array<{
    label: string;
    count: number;
    href: string;
    /** Money behind a count, for the queue where the count is not the story. */
    amount?: number | null;
  }> = [
    {
      label: t.awaitingFundingCases,
      count: dashboard.counts.casesAwaitingFunding,
      // A count says how many cases are stuck; this says what finding their
      // money costs, from the same rows the funding desk lists.
      amount:
        dashboard.counts.casesAwaitingFunding > 0
          ? dashboard.funding.summary.need
          : null,
      href: "/treasury/fund",
    },
    {
      label: t.awaitingApprovalAllocations,
      count: dashboard.counts.allocationsAwaitingApproval,
      href: "/treasury/budgets",
    },
    {
      label: t.awaitingApprovalEarmarks,
      count: dashboard.counts.earmarksAwaitingApproval,
      href: "/treasury/earmarks",
    },
    {
      label: t.awaitingCertification,
      count: dashboard.counts.vouchersAwaitingCertification,
      href: "/treasury/disbursements",
    },
    {
      label: t.awaitingApprovalVouchers,
      count: dashboard.counts.vouchersAwaitingApproval,
      href: "/captain/approvals",
    },
    {
      label: t.awaitingRelease,
      count: dashboard.counts.vouchersAwaitingRelease,
      href: "/treasury/disbursements",
    },
    {
      label: t.awaitingLiquidation,
      count: dashboard.counts.vouchersAwaitingLiquidation,
      href: "/treasury/disbursements",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title={t.dashboardTitle} description={t.dashboardLead} />
        <div className="flex gap-2">
          <Button href="/treasury/fund" size="sm">
            {t.navFundCase}
          </Button>
          <Button href="/treasury/budgets" size="sm" variant="outline">
            {t.navBudgets}
          </Button>
          <Button href="/treasury/disbursements" size="sm" variant="outline">
            {t.navDisbursements}
          </Button>
        </div>
      </div>

      <Card title={guide.title} description={guide.lead}>
        <StepGuide steps={guide.steps} />
      </Card>

      <BalanceCards totals={dashboard.totals} locale={locale} />

      {/* The balances say what the treasury holds; this says what the cases
          are waiting on, in pesos and per case. */}
      <FundingNeedCard funding={dashboard.funding} locale={locale} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t.pendingTitle}>
          <ul className="divide-y divide-line">
            {pending.map((entry) => (
              <li
                key={entry.label}
                className="flex items-center justify-between gap-3 py-2"
              >
                <span className="text-sm text-ink-muted">{entry.label}</span>
                <span className="flex items-center gap-3">
                  {entry.amount ? (
                    <span className="text-xs font-semibold tabular-nums text-ink-muted">
                      {formatPeso(entry.amount)}
                    </span>
                  ) : null}
                  <span className="text-sm font-semibold tabular-nums text-ink">
                    {entry.count}
                  </span>
                  <Button href={entry.href} size="sm" variant="ghost">
                    {t.open}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
          {(dashboard.counts.unverifiedCoaAccounts > 0 ||
            dashboard.counts.unverifiedFundSources > 0) && (
            <div className="mt-3 space-y-1 border-t border-line pt-3 text-xs text-amber-700">
              {dashboard.counts.unverifiedCoaAccounts > 0 && (
                <p>
                  {t.unverifiedCodes}: {dashboard.counts.unverifiedCoaAccounts}
                </p>
              )}
              {dashboard.counts.unverifiedFundSources > 0 && (
                <p>
                  {t.unverifiedFundSources}:{" "}
                  {dashboard.counts.unverifiedFundSources}
                </p>
              )}
            </div>
          )}
        </Card>

        <Card title={t.agingTitle} description={t.agingLead}>
          <AgingBars aging={dashboard.aging} locale={locale} />
        </Card>
      </div>

      <Card title={t.ledgerTitle} description={t.ledgerLead}>
        <LedgerTable
          entries={dashboard.recentLedger}
          locale={locale}
          showAllocation
        />
        <div className="mt-3">
          <Button href="/treasury/ledger" size="sm" variant="outline">
            {t.navLedger}
          </Button>
        </div>
      </Card>
    </div>
  );
}
