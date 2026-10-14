import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AllocationActions } from "@/components/treasury/allocation-actions";
import { EarmarkActions } from "@/components/treasury/earmark-actions";
import { EarmarkForm } from "@/components/treasury/earmark-form";
import {
  EarmarkReview,
  earmarkReviewFacts,
} from "@/components/treasury/earmark-review";
import { LedgerTable } from "@/components/treasury/ledger-table";
import { VoucherForm } from "@/components/treasury/voucher-form";
import { PageHeader } from "@/components/ui/page-header";
import { formatPeso } from "@/lib/cases/manpower";
import { formatDateTime } from "@/lib/format";
import { db } from "@/lib/db";
import { requirePermission, userCan } from "@/lib/auth/session";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";
import { allocationBalance, loadAllocationForActor } from "@/lib/treasury/budget";
import { briefForEarmarkRow } from "@/lib/treasury/approval";
import {
  ledgerRegister,
  listDisbursements,
  listEarmarks,
} from "@/lib/treasury/query";

export const metadata: Metadata = {
  title: "Allocation",
};

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

/**
 * One appropriation: its live balance, the earmarks that reserved part of it,
 * the vouchers drawn on it and its slice of the ledger.
 */
export default async function TreasuryAllocationPage({ params }: PageProps) {
  const user = await requirePermission("treasury.balance.view");
  const { id } = await params;
  const allocationId = Number(id);
  if (!Number.isInteger(allocationId) || allocationId <= 0) notFound();

  const locale = await getLocale();
  const t = copy[locale].revamp.treasuryDesk;
  const actor = {
    id: user.id,
    roleKey: user.role.key,
    officeId: user.officeId ?? null,
  };

  const allocation = await loadAllocationForActor(db, allocationId, actor).catch(
    () => null
  );
  if (!allocation) notFound();

  const [
    balance,
    earmarks,
    vouchers,
    ledger,
    canApprove,
    canApproveEarmark,
    canPrepareEarmark,
    canPrepareVoucher,
  ] = await Promise.all([
    allocationBalance(db, allocationId),
    // The earmark brief needs the live balance of the allocation (already loaded
    // above for the header, but per-row so the cards are self-contained) and how
    // much is set aside per case.
    listEarmarks(db, { actor, allocationId, includeApprovalContext: true }),
    listDisbursements(db, { actor, allocationId }),
    ledgerRegister(db, { actor, allocationId, take: 50 }),
    userCan(user.role.key, "treasury.allocation.approve"),
    // Earmarks are decided on their own permissions. This page used to offer the
    // earmark Approve and Cancel buttons behind the *allocation* permissions,
    // which is a different right — a role holding one but not the other was
    // shown a button the API would then refuse.
    userCan(user.role.key, "treasury.earmark.approve"),
    userCan(user.role.key, "treasury.earmark.prepare"),
    userCan(user.role.key, "treasury.disbursement.prepare"),
  ]);

  const earmarkBriefs = new Map(
    earmarks.map((row) => [
      row.id,
      briefForEarmarkRow(row, {
        id: actor.id,
        canApprove: canApproveEarmark,
      }),
    ])
  );

  const figures = [
    { label: t.appropriation, value: balance.appropriated, tone: "text-ink" },
    { label: t.reserved, value: balance.reserved, tone: "text-amber-700" },
    { label: t.disbursed, value: balance.disbursed, tone: "text-ink-muted" },
    { label: t.available, value: balance.available, tone: "text-emerald-700" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={allocation.label}
        description={
          <>
            {allocation.coaAccount.code} · {allocation.coaAccount.name} · FY{" "}
            {allocation.fiscalYear.year} · {allocation.fundSource.code}
            {allocation.office
              ? ` · ${allocation.office.name}`
              : ` · ${t.officeWideWard}`}
          </>
        }
        actions={
          <>
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
            <Button href="/treasury/budgets" size="sm" variant="outline">
              {t.navBudgets}
            </Button>
          </>
        }
      />

      {!balance.consistent && (
        <p className="rounded-control border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {t.ledgerLead}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {figures.map((figure) => (
          <Card key={figure.label}>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
              {figure.label}
            </p>
            <p className={`mt-1 text-xl font-bold ${figure.tone}`}>
              {formatPeso(figure.value)}
            </p>
          </Card>
        ))}
      </div>

      <Card title={t.approveAllocation}>
        <AllocationActions
          allocationId={allocation.id}
          status={allocation.status}
          available={balance.available}
          canApprove={canApprove}
          canAdjust={user.role.key === "ADMIN"}
          canClose={canApprove}
          locale={locale}
        />
      </Card>

      <Card
        title={t.earmarksTitle}
        description={t.earmarksLead}
      >
        {canPrepareEarmark && allocation.status === "APPROVED" ? (
          <div className="mb-4">
            <EarmarkForm
              allocations={[
                {
                  id: allocation.id,
                  label: allocation.label,
                  coaCode: allocation.coaAccount.code,
                  fundSourceCode: allocation.fundSource.code,
                  available: balance.available,
                },
              ]}
              presetAllocationId={allocation.id}
              locale={locale}
            />
          </div>
        ) : null}

        {earmarks.length === 0 ? (
          <p className="text-sm text-ink-subtle">{t.noEntries}</p>
        ) : (
          <ul className="divide-y divide-line">
            {earmarks.map((earmark) => {
              const brief = earmarkBriefs.get(earmark.id);
              if (!brief) return null;
              return (
                <li key={earmark.id} className="space-y-3 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-ink-subtle">
                      {earmark.code ?? `#${earmark.id}`}
                    </span>
                    <Badge
                      tone={
                        earmark.status === "APPROVED"
                          ? "amber"
                          : earmark.status === "PROPOSED"
                            ? "sky"
                            : "gray"
                      }
                    >
                      {earmark.status}
                    </Badge>
                    <span className="text-sm font-semibold text-ink">
                      {formatPeso(earmark.amount)}
                    </span>
                    {earmark.committed > 0 && (
                      <span className="text-xs text-ink-subtle">
                        {t.earmarkCommitted}: {formatPeso(earmark.committed)}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-ink-muted">{earmark.purpose}</p>
                  <p className="text-xs text-ink-subtle">
                    {earmark.caseNumber ? `${earmark.caseNumber} · ` : ""}
                    {formatDateTime(earmark.preparedAt)}
                  </p>

                  {/* On the allocation page the balance is already on screen, so
                      the brief is what ties each earmark back to a concern. */}
                  <EarmarkReview
                    earmark={earmarkReviewFacts(earmark)}
                    brief={brief}
                    locale={locale}
                    compact
                  />

                  <EarmarkActions
                    earmarkId={earmark.id}
                    status={earmark.status}
                    brief={brief}
                    allocationLabel={earmark.allocationLabel}
                    caseNumber={earmark.caseNumber}
                    canCancel={canPrepareEarmark}
                    locale={locale}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card title={t.disbursementsTitle} description={t.disbursementsLead}>
        {canPrepareVoucher && allocation.status === "APPROVED" ? (
          <div className="mb-4">
            <VoucherForm
              allocations={[
                {
                  id: allocation.id,
                  label: allocation.label,
                  coaCode: allocation.coaAccount.code,
                  available: balance.available,
                },
              ]}
              earmarks={earmarks
                .filter((earmark) => earmark.status === "APPROVED")
                .map((earmark) => ({
                  id: earmark.id,
                  code: earmark.code,
                  purpose: earmark.purpose,
                  amount: earmark.amount,
                  committed: earmark.committed,
                }))}
              presetAllocationId={allocation.id}
              locale={locale}
            />
          </div>
        ) : null}

        {vouchers.length === 0 ? (
          <p className="text-sm text-ink-subtle">{t.noEntries}</p>
        ) : (
          <ul className="divide-y divide-line">
            {vouchers.map((voucher) => (
              <li
                key={voucher.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-ink-subtle">
                      {voucher.voucherNumber ?? `#${voucher.id}`}
                    </span>
                    <Badge tone={voucher.status === "RELEASED" ? "green" : "sky"}>
                      {voucher.statusLabel}
                    </Badge>
                    <span className="text-sm font-semibold text-ink">
                      {formatPeso(voucher.amount)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-ink-muted">{voucher.payee}</p>
                  <p className="text-xs text-ink-subtle">
                    {voucher.particulars}
                  </p>
                </div>
                <Button
                  href={`/treasury/disbursements/${voucher.id}`}
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

      <Card title={t.ledgerTitle} description={t.ledgerLead}>
        <LedgerTable entries={ledger} locale={locale} />
      </Card>
    </div>
  );
}
