import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AllocationActions } from "@/components/treasury/allocation-actions";
import { EarmarkActions } from "@/components/treasury/earmark-actions";
import {
  EarmarkReview,
  earmarkReviewFacts,
} from "@/components/treasury/earmark-review";
import { PageHeader } from "@/components/ui/page-header";
import { formatPeso } from "@/lib/cases/manpower";
import { formatDateTime } from "@/lib/format";
import { db } from "@/lib/db";
import { requirePermission, userCan } from "@/lib/auth/session";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";
import { briefForEarmarkRow } from "@/lib/treasury/approval";
import {
  listAllocations,
  listDisbursements,
  listEarmarks,
} from "@/lib/treasury/query";

export const metadata: Metadata = {
  title: "Approvals",
};

export const dynamic = "force-dynamic";

/**
 * The Barangay Captain's approval desk (Authorized Approving Official):
 * appropriations to open, earmarks to reserve and vouchers to approve for
 * release. The treasurer's certification always comes first, and the same
 * person can never fill both roles.
 *
 * An earmark arriving here was prepared by somebody else — usually the
 * treasurer or an administrator — so the Captain is being asked to commit money
 * to a resident's concern they did not scope. Each proposal therefore carries
 * the approval brief: which case it is for, what that case's estimate is, what
 * is already set aside, which budget it comes out of and what approving it
 * changes. Without that the decision was a code, an amount and a purpose.
 */
export default async function CaptainApprovalsPage() {
  const user = await requirePermission("treasury.disbursement.approve");
  const locale = await getLocale();
  const t = copy[locale].revamp.treasuryDesk;
  const actor = {
    id: user.id,
    roleKey: user.role.key,
    officeId: user.officeId ?? null,
  };

  const [allocations, earmarks, vouchers, canApproveEarmark] =
    await Promise.all([
      listAllocations(db, { actor, status: "DRAFT" }),
      // includeApprovalContext: the brief needs the live balance of each source
      // allocation and how much is already set aside per case.
      listEarmarks(db, {
        actor,
        status: "PROPOSED",
        includeApprovalContext: true,
      }),
      listDisbursements(db, { actor, status: "CERTIFIED" }),
      userCan(user.role.key, "treasury.earmark.approve"),
    ]);

  // A case a resident is waiting on outranks the rest of the queue.
  const earmarkBriefs = new Map(
    earmarks.map((row) => [
      row.id,
      briefForEarmarkRow(row, {
        id: actor.id,
        canApprove: canApproveEarmark,
      }),
    ])
  );
  const queuedEarmarks = [...earmarks].sort((a, b) => {
    const waiting =
      Number(earmarkBriefs.get(b.id)?.caseWaitingForBudget ?? false) -
      Number(earmarkBriefs.get(a.id)?.caseWaitingForBudget ?? false);
    return waiting !== 0
      ? waiting
      : a.preparedAt.getTime() - b.preparedAt.getTime();
  });

  const nothingWaiting =
    allocations.length === 0 && earmarks.length === 0 && vouchers.length === 0;

  return (
    <div className="space-y-6">
      <PageHeader title={t.captainApprovalsTitle} description={t.captainApprovalsLead} />

      {nothingWaiting && (
        <Card>
          <p className="text-sm text-ink-subtle">{t.captainApprovalsEmpty}</p>
        </Card>
      )}

      {allocations.length > 0 && (
        <Card title={t.awaitingApprovalAllocations}>
          <ul className="divide-y divide-line">
            {allocations.map((allocation) => (
              <li key={allocation.id} className="space-y-2 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="amber">{allocation.status}</Badge>
                  <span className="text-sm font-semibold text-ink">
                    {allocation.label}
                  </span>
                  <span className="text-sm tabular-nums text-ink-muted">
                    {formatPeso(allocation.appropriation)}
                  </span>
                </div>
                <p className="text-xs text-ink-subtle">
                  {allocation.coaCode} — {allocation.coaName} ·{" "}
                  {allocation.fundSourceCode} · FY {allocation.fiscalYear}
                  {allocation.officeName ? ` · ${allocation.officeName}` : ""}
                </p>
                <AllocationActions
                  allocationId={allocation.id}
                  status={allocation.status}
                  available={allocation.available}
                  canApprove
                  canAdjust={false}
                  canClose={false}
                  locale={locale}
                />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {queuedEarmarks.length > 0 && (
        <Card
          title={t.awaitingApprovalEarmarks}
          description={t.earmarkReview.lead}
        >
          <ul className="divide-y divide-line">
            {queuedEarmarks.map((earmark) => {
              const brief = earmarkBriefs.get(earmark.id);
              if (!brief) return null;
              return (
                <li key={earmark.id} className="space-y-3 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-ink-subtle">
                      {earmark.code ?? `#${earmark.id}`}
                    </span>
                    <Badge tone="sky">{earmark.status}</Badge>
                    <span className="text-sm font-semibold text-ink">
                      {formatPeso(earmark.amount)}
                    </span>
                  </div>
                  <p className="text-sm text-ink-muted">{earmark.purpose}</p>

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
                    canCancel={false}
                    locale={locale}
                  />
                  <div className="flex flex-wrap gap-2">
                    {earmark.concernId && (
                      <Button
                        href={`/official/concerns/${earmark.concernId}`}
                        size="sm"
                        variant="ghost"
                      >
                        {t.earmarkReview.openCase}
                      </Button>
                    )}
                    <Button
                      href={`/treasury/budgets/${earmark.allocationId}`}
                      size="sm"
                      variant="ghost"
                    >
                      {t.navBudgets}
                    </Button>
                  </div>
                  <p className="text-xs text-ink-subtle">
                    {formatDateTime(earmark.preparedAt)}
                  </p>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {vouchers.length > 0 && (
        <Card title={t.awaitingApprovalVouchers}>
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
                    <Badge tone="amber">{voucher.statusLabel}</Badge>
                    <span className="text-sm font-semibold text-ink">
                      {formatPeso(voucher.amount)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-ink-muted">{voucher.payee}</p>
                  <p className="text-xs text-ink-subtle">
                    {voucher.particulars} · {voucher.coaCode}
                    {voucher.caseNumber ? ` · ${voucher.caseNumber}` : ""}
                  </p>
                </div>
                <Button
                  href={`/treasury/disbursements/${voucher.id}`}
                  size="sm"
                >
                  {t.open}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
