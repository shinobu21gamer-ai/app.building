import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AllocationActions } from "@/components/treasury/allocation-actions";
import { EarmarkActions } from "@/components/treasury/earmark-actions";
import { formatPeso } from "@/lib/cases/manpower";
import { formatDateTime } from "@/lib/format";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";
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

  const [allocations, earmarks, vouchers] = await Promise.all([
    listAllocations(db, { actor, status: "DRAFT" }),
    listEarmarks(db, { actor, status: "PROPOSED" }),
    listDisbursements(db, { actor, status: "CERTIFIED" }),
  ]);

  const nothingWaiting =
    allocations.length === 0 && earmarks.length === 0 && vouchers.length === 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-title text-ink sm:text-display">
          {t.captainApprovalsTitle}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">{t.captainApprovalsLead}</p>
      </div>

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

      {earmarks.length > 0 && (
        <Card title={t.awaitingApprovalEarmarks}>
          <ul className="divide-y divide-line">
            {earmarks.map((earmark) => (
              <li key={earmark.id} className="space-y-2 py-3">
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
                <p className="text-xs text-ink-subtle">
                  {earmark.coaCode} · {earmark.fundSourceCode}
                  {earmark.caseNumber ? ` · ${earmark.caseNumber}` : ""} ·{" "}
                  {formatDateTime(earmark.preparedAt)}
                </p>
                <EarmarkActions
                  earmarkId={earmark.id}
                  status={earmark.status}
                  canApprove
                  canCancel={false}
                  locale={locale}
                />
              </li>
            ))}
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
