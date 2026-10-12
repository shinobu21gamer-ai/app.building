import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { VoucherActions } from "@/components/treasury/voucher-actions";
import { PageHeader } from "@/components/ui/page-header";
import { formatPeso } from "@/lib/cases/manpower";
import { formatDate, formatDateTime } from "@/lib/format";
import { db } from "@/lib/db";
import { getEffectivePermissions, requirePermission } from "@/lib/auth/session";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";
import { allocationBalance } from "@/lib/treasury/budget";
import {
  loadVoucherForActor,
  voucherActionAvailability,
} from "@/lib/treasury/disbursement";

export const metadata: Metadata = {
  title: "Disbursement voucher",
};

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

/**
 * One voucher: what it pays, which appropriation it draws on, what the ledger
 * says is left, who has decided what so far, and the steps this signed-in role
 * may still take.
 */
export default async function TreasuryDisbursementPage({ params }: PageProps) {
  const user = await requirePermission("treasury.balance.view");
  const { id } = await params;
  const disbursementId = Number(id);
  if (!Number.isInteger(disbursementId) || disbursementId <= 0) notFound();

  const locale = await getLocale();
  const t = copy[locale].revamp.treasuryDesk;
  const actor = {
    id: user.id,
    roleKey: user.role.key,
    officeId: user.officeId ?? null,
  };

  const voucher = await loadVoucherForActor(db, disbursementId, actor).catch(
    () => null
  );
  if (!voucher) notFound();

  const [balance, permissions] = await Promise.all([
    allocationBalance(db, voucher.allocationId),
    getEffectivePermissions(user.role.key),
  ]);

  const actions = voucherActionAvailability({
    status: voucher.status,
    preparedById: voucher.preparedById,
    approvals: voucher.approvals.map((row) => ({
      level: row.level,
      approverId: row.approverId,
      decision: row.decision,
    })),
    actor,
    permissions,
  });

  const details: Array<[string, string]> = [
    [t.payee, `${voucher.payee} (${voucher.payeeType})`],
    [t.amountLabel, formatPeso(Number(voucher.amount))],
    [t.particulars, voucher.particulars],
    [t.modeOfPayment, voucher.modeOfPayment ?? "—"],
    [
      t.coaAccount,
      `${voucher.allocation.coaAccount.code} — ${voucher.allocation.coaAccount.name}`,
    ],
    [t.fundSource, voucher.allocation.fundSource.code],
    [t.earmarksTitle, voucher.earmark?.code ?? "—"],
    [t.linkedCase, voucher.concern?.caseNumber ?? "—"],
    [t.ledgerAvailableAfter, formatPeso(balance.available)],
    [t.ledgerActor, formatDateTime(voucher.preparedAt)],
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={voucher.voucherNumber ?? `#${voucher.id}`}
        description={
          <>
            {voucher.allocation.label} · FY {voucher.allocation.fiscalYear.year}
          </>
        }
        actions={
          <>
            <Badge tone={voucher.status === "LIQUIDATED" ? "green" : "sky"}>
              {voucher.status}
            </Badge>
            <Button href="/treasury/disbursements" size="sm" variant="outline">
              {t.navDisbursements}
            </Button>
            <Button
              href={`/treasury/budgets/${voucher.allocationId}`}
              size="sm"
              variant="outline"
            >
              {t.navBudgets}
            </Button>
          </>
        }
      />

      {voucher.liquidationDueAt && voucher.status === "RELEASED" && (
        <p className="rounded-control border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {t.liquidationDue}: {formatDate(voucher.liquidationDueAt)}
          {voucher.liquidationStatus ? ` · ${voucher.liquidationStatus}` : ""}
        </p>
      )}
      {voucher.rejectionReason && (
        <p className="rounded-control border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {t.rejectVoucher}: {voucher.rejectionReason}
        </p>
      )}
      {voucher.cancelReason && (
        <p className="rounded-control border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {t.cancelVoucher}: {voucher.cancelReason}
        </p>
      )}

      <Card title={t.disbursementsTitle}>
        <dl className="grid gap-3 sm:grid-cols-2">
          {details.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                {label}
              </dt>
              <dd className="mt-0.5 text-sm text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card title={t.approvalsTitle} description={t.approvalSelfBlocked}>
        {voucher.approvals.length === 0 ? (
          <p className="text-sm text-ink-subtle">{t.noEntries}</p>
        ) : (
          <ul className="divide-y divide-line">
            {voucher.approvals.map((approval) => (
              <li
                key={`${approval.level}-${approval.approverId}`}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <span className="text-sm text-ink-muted">
                  {approval.level === 1 ? t.approvalLevel1 : t.approvalLevel2}
                </span>
                <span className="flex items-center gap-2">
                  <Badge
                    tone={
                      approval.decision === "APPROVED" ||
                      approval.decision === "CERTIFIED"
                        ? "green"
                        : "red"
                    }
                  >
                    {approval.decision}
                  </Badge>
                  <span className="text-xs text-ink-subtle">
                    {approval.approverRole} ·{" "}
                    {formatDateTime(approval.decidedAt)}
                  </span>
                </span>
                {approval.remarks && (
                  <p className="w-full text-xs text-ink-subtle">
                    {approval.remarks}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={t.pendingTitle}>
        <VoucherActions
          disbursementId={voucher.id}
          voucherNumber={voucher.voucherNumber}
          actions={actions}
          locale={locale}
        />
      </Card>
    </div>
  );
}
