import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AllocationForm } from "@/components/treasury/allocation-form";
import { PageHeader } from "@/components/ui/page-header";
import { formatPeso } from "@/lib/cases/manpower";
import { db } from "@/lib/db";
import { requirePermission, userCan } from "@/lib/auth/session";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";
import {
  allocationBlockers,
  allocationPrefill,
  prefillIsEmpty,
  type RegisterLine,
} from "@/lib/treasury/allocation-guide";
import { listAllocations } from "@/lib/treasury/query";

export const metadata: Metadata = {
  title: "Budgets",
};

export const dynamic = "force-dynamic";

const STATUS_TONES: Record<string, "amber" | "green" | "gray"> = {
  DRAFT: "amber",
  APPROVED: "green",
  CLOSED: "gray",
};

/**
 * The appropriation register. Each row shows the appropriation and the live
 * balance derived from the ledger, so nobody has to add anything up by hand.
 *
 * The New allocation card is the guided way in: it asks the three questions
 * one at a time, states the line being created in words, and refuses to
 * prepare a line the register already holds — the same refusal the server
 * would give, but delivered with a link to the existing line instead of a
 * dead end. `?amount=`, `?office=` and `?case=` are how a case's funding panel
 * hands its own numbers over (see `allocation-guide.ts`).
 */
export default async function TreasuryBudgetsPage({
  searchParams,
}: {
  searchParams: Promise<{
    amount?: string;
    office?: string;
    case?: string;
    concern?: string;
  }>;
}) {
  const user = await requirePermission("treasury.balance.view");
  const params = await searchParams;
  const locale = await getLocale();
  const t = copy[locale].revamp.treasuryDesk;
  const common = copy[locale].revamp.common;
  const actor = {
    id: user.id,
    roleKey: user.role.key,
    officeId: user.officeId ?? null,
  };

  const canPrepare = await userCan(user.role.key, "treasury.allocation.prepare");

  const [allocations, fiscalYears, fundSources, coaAccounts, offices] =
    await Promise.all([
      // Wider than the register's default page: the register doubles as the
      // duplicate check for the form below, so a line further down the list is
      // still recognised before someone tries to add it a second time. A
      // register past this many lines only loses the pre-check — the server
      // still refuses the duplicate, which is where it was caught before.
      listAllocations(db, { actor, take: 200 }),
      db.fiscalYear.findMany({
        orderBy: { year: "desc" },
        select: { id: true, year: true, isClosed: true },
      }),
      db.fundSource.findMany({
        where: { verificationStatus: "VERIFIED", isActive: true },
        orderBy: { code: "asc" },
        select: { id: true, code: true, name: true },
      }),
      db.coaAccount.findMany({
        where: {
          verificationStatus: "VERIFIED",
          isActive: true,
          isMooe: true,
        },
        orderBy: { code: "asc" },
        select: { id: true, code: true, name: true },
      }),
      db.office.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
    ]);

  // What the form cannot work around: a line needs a verified fund source and
  // a verified MOOE account to exist at all, and both are verified on another
  // screen. An open fiscal year is the form's own business — it says so and
  // offers the administrator the way to open one.
  const blockers = allocationBlockers({ fiscalYears, fundSources, coaAccounts });
  const needsReferences =
    blockers.includes("NO_VERIFIED_FUND_SOURCE") ||
    blockers.includes("NO_VERIFIED_COA_ACCOUNT");

  const officeIds = offices.map((office: { id: number }) => office.id);
  const prefill = allocationPrefill(params, { officeIds });

  const register: RegisterLine[] = allocations.map((allocation) => ({
    id: allocation.id,
    label: allocation.label,
    status: allocation.status,
    fiscalYearId: allocation.fiscalYearId,
    fundSourceCode: allocation.fundSourceCode,
    coaCode: allocation.coaCode,
    officeId: allocation.officeId,
  }));

  return (
    <div className="space-y-6">
      <PageHeader title={t.budgetsTitle} description={t.budgetsLead} />

      <Card
        title={t.budgetWorkflowTitle}
        description={t.budgetWorkflowLead}
      >
        <Button href="/treasury/codes" size="sm" variant="outline">
          {t.navCodes}
        </Button>
      </Card>

      {canPrepare && (
        <Card
          title={t.newAllocation}
          description={needsReferences ? t.codesLead : undefined}
        >
          {needsReferences ? (
            <div className="space-y-3">
              {blockers.includes("NO_VERIFIED_FUND_SOURCE") && (
                <p className="text-sm text-ink-muted">
                  {t.noVerifiedFundSource}
                </p>
              )}
              {blockers.includes("NO_VERIFIED_COA_ACCOUNT") && (
                <p className="text-sm text-ink-muted">
                  {t.noVerifiedMooeAccount}
                </p>
              )}
              <Button href="/treasury/codes" size="sm" variant="outline">
                {t.navCodes}
              </Button>
            </div>
          ) : (
            <AllocationForm
              fiscalYears={fiscalYears}
              canOpenFiscalYear={user.role.key === "ADMIN"}
              fundSources={fundSources}
              coaAccounts={coaAccounts}
              offices={offices}
              register={register}
              prefill={prefillIsEmpty(prefill) ? null : prefill}
              locale={locale}
            />
          )}
        </Card>
      )}

      {allocations.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-subtle">{t.noEntries}</p>
        </Card>
      ) : (
        <Card>
          <div className="-mx-5 overflow-x-auto px-5">
            <table data-stack className="w-full min-w-[54rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-subtle">
                  <th className="py-2 pr-3 font-medium">{t.allocationLabel}</th>
                  <th className="py-2 pr-3 font-medium">{t.coaAccount}</th>
                  <th className="py-2 pr-3 font-medium">{t.fundingTitle}</th>
                  <th className="py-2 pr-3 text-right font-medium">
                    {t.appropriation}
                  </th>
                  <th className="py-2 pr-3 text-right font-medium">
                    {t.reserved}
                  </th>
                  <th className="py-2 pr-3 text-right font-medium">
                    {t.disbursed}
                  </th>
                  <th className="py-2 pr-3 text-right font-medium">
                    {t.available}
                  </th>
                  <th className="py-2 pr-3 font-medium">{t.office}</th>
                  <th className="py-2 pr-3 font-medium">{common.status}</th>
                </tr>
              </thead>
              <tbody>
                {allocations.map((allocation) => (
                  <tr
                    key={allocation.id}
                    className="border-b border-line align-top"
                  >
                    <td data-label={t.allocationLabel} className="py-2 pr-3">
                      <Button
                        href={`/treasury/budgets/${allocation.id}`}
                        size="sm"
                        variant="ghost"
                        className="px-0"
                      >
                        {allocation.label}
                      </Button>
                      <p className="text-xs text-ink-faint">
                        FY {allocation.fiscalYear}
                        {allocation.consistent ? "" : " · ledger check needed"}
                      </p>
                    </td>
                    <td data-label={t.coaAccount} className="py-2 pr-3 font-mono text-xs text-ink-muted">
                      {allocation.coaCode}
                      <p className="font-sans text-xs text-ink-subtle">
                        {allocation.coaName}
                      </p>
                    </td>
                    <td data-label={t.fundingTitle} className="py-2 pr-3 text-xs text-ink-muted">
                      {allocation.fundSourceCode}
                      <p className="text-ink-subtle">{allocation.fundSourceName}</p>
                    </td>
                    <td data-label={t.appropriation} className="py-2 pr-3 text-right tabular-nums">
                      {formatPeso(allocation.appropriation)}
                    </td>
                    <td data-label={t.reserved} className="py-2 pr-3 text-right tabular-nums text-amber-700">
                      {formatPeso(allocation.reserved)}
                    </td>
                    <td data-label={t.disbursed} className="py-2 pr-3 text-right tabular-nums text-ink-muted">
                      {formatPeso(allocation.disbursed)}
                    </td>
                    <td data-label={t.available} className="py-2 pr-3 text-right font-semibold tabular-nums text-emerald-700">
                      {formatPeso(allocation.available)}
                    </td>
                    <td data-label={t.office} className="py-2 pr-3 text-xs text-ink-muted">
                      {allocation.officeName ?? t.officeWideWard}
                    </td>
                    <td data-label={common.status} className="py-2 pr-3">
                      <Badge tone={STATUS_TONES[allocation.status] ?? "neutral"}>
                        {allocation.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
