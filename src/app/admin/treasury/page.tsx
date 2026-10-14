import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FiscalYearActions } from "@/components/treasury/fiscal-year-actions";
import { FiscalYearForm } from "@/components/treasury/fiscal-year-form";
import { VerifyRecordForm } from "@/components/treasury/verify-record-form";
import { PageHeader } from "@/components/ui/page-header";
import { formatDate } from "@/lib/format";
import { formatPeso } from "@/lib/cases/manpower";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";
import { listAllocations } from "@/lib/treasury/query";

export const metadata: Metadata = {
  title: "Treasury configuration",
};

export const dynamic = "force-dynamic";

/**
 * Administrator view of the treasury frame: the fiscal years, the fund sources
 * that still need confirming against the appropriation ordinance, and the
 * appropriation register across every office.
 */
export default async function AdminTreasuryPage() {
  const user = await requirePermission("treasury.balance.view");
  const locale = await getLocale();
  const t = copy[locale].revamp.treasuryDesk;
  const actor = {
    id: user.id,
    roleKey: user.role.key,
    officeId: user.officeId ?? null,
  };

  const [fiscalYears, fundSources, allocations] = await Promise.all([
    db.fiscalYear.findMany({
      orderBy: { year: "desc" },
      include: {
        allocations: {
          select: { id: true, appropriation: true, status: true },
        },
      },
    }),
    db.fundSource.findMany({ orderBy: { code: "asc" } }),
    listAllocations(db, { actor, take: 200 }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title={t.adminTreasuryTitle} description={t.adminTreasuryLead} />
        <div className="flex gap-2">
          <Button href="/treasury/budgets" size="sm" variant="outline">
            {t.navBudgets}
          </Button>
          <Button href="/treasury/codes" size="sm" variant="outline">
            {t.navCodes}
          </Button>
        </div>
      </div>

      <Card
        title={t.fiscalYearsTitle}
        description={t.fiscalYearBudgetHelp}
      >
        <div className="mb-4">
          <FiscalYearForm locale={locale} />
        </div>
        <ul className="divide-y divide-line">
          {fiscalYears.map((year) => (
            <li key={year.id} className="space-y-2 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-ink">
                  {year.name}
                </span>
                <Badge tone={year.isClosed ? "gray" : "green"}>
                  {year.isClosed ? t.closeFiscalYear : t.fiscalYearYear}
                </Badge>
                <span className="text-xs text-ink-subtle">
                  {formatDate(year.startsOn)} → {formatDate(year.endsOn)}
                </span>
              </div>
              <p className="text-xs text-ink-subtle">
                {year.allocations.length} {t.allocationCountLabel} ·{" "}
                {formatPeso(
                  year.allocations.reduce(
                    (sum, allocation) => sum + Number(allocation.appropriation),
                    0
                  )
                )}
              </p>
              <FiscalYearActions
                fiscalYearId={year.id}
                isClosed={year.isClosed}
                locale={locale}
              />
            </li>
          ))}
        </ul>
      </Card>

      <Card title={t.fundSource}>
        <ul className="divide-y divide-line">
          {fundSources.map((source) => (
            <li key={source.id} className="space-y-2 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-ink-muted">
                  {source.code}
                </span>
                <Badge
                  tone={
                    source.verificationStatus === "VERIFIED"
                      ? "green"
                      : source.verificationStatus === "UNVERIFIED"
                        ? "amber"
                        : "gray"
                  }
                >
                  {source.verificationStatus}
                </Badge>
                <span className="text-sm text-ink">{source.name}</span>
              </div>
              {source.verificationSource && (
                <p className="text-xs text-ink-subtle">
                  {t.verificationSource}: {source.verificationSource}
                </p>
              )}
              <VerifyRecordForm
                kind="FUND"
                recordId={source.id}
                currentStatus={source.verificationStatus}
                locale={locale}
              />
            </li>
          ))}
        </ul>
      </Card>

      <Card title={t.budgetsTitle} description={t.budgetsLead}>
        {allocations.length === 0 ? (
          <p className="text-sm text-ink-subtle">{t.noEntries}</p>
        ) : (
          <ul className="divide-y divide-line">
            {allocations.map((allocation) => (
              <li
                key={allocation.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      tone={
                        allocation.status === "APPROVED"
                          ? "green"
                          : allocation.status === "DRAFT"
                            ? "amber"
                            : "gray"
                      }
                    >
                      {allocation.status}
                    </Badge>
                    <span className="text-sm font-semibold text-ink">
                      {allocation.label}
                    </span>
                    <span className="text-sm tabular-nums text-ink-muted">
                      {formatPeso(allocation.available)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-ink-subtle">
                    {allocation.coaCode} · {allocation.fundSourceCode} · FY{" "}
                    {allocation.fiscalYear}
                    {allocation.officeName ? ` · ${allocation.officeName}` : ""}
                  </p>
                </div>
                <Button
                  href={`/treasury/budgets/${allocation.id}`}
                  size="sm"
                  variant="outline"
                >
                  {t.open}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
