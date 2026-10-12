import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { VoucherForm } from "@/components/treasury/voucher-form";
import { PageHeader } from "@/components/ui/page-header";
import { formatPeso } from "@/lib/cases/manpower";
import { formatDateTime } from "@/lib/format";
import { db } from "@/lib/db";
import { requirePermission, userCan } from "@/lib/auth/session";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";
import {
  listAllocations,
  listDisbursements,
  listEarmarks,
} from "@/lib/treasury/query";

export const metadata: Metadata = {
  title: "Disbursement vouchers",
};

export const dynamic = "force-dynamic";

const TONES: Record<string, "sky" | "amber" | "green" | "gray" | "red"> = {
  DRAFT: "gray",
  SUBMITTED: "sky",
  CERTIFIED: "amber",
  APPROVED: "amber",
  RELEASED: "green",
  LIQUIDATED: "green",
  REJECTED: "red",
  CANCELLED: "red",
};

type PageProps = { searchParams: Promise<{ status?: string }> };

/** The voucher register: every step from draft to liquidation, newest first. */
export default async function TreasuryDisbursementsPage({
  searchParams,
}: PageProps) {
  const user = await requirePermission("treasury.balance.view");
  const { status } = await searchParams;
  const locale = await getLocale();
  const t = copy[locale].revamp.treasuryDesk;
  const actor = {
    id: user.id,
    roleKey: user.role.key,
    officeId: user.officeId ?? null,
  };

  const [vouchers, allocations, approvedEarmarks, openCases, canPrepare] =
    await Promise.all([
      listDisbursements(db, {
        actor,
        status: status && status !== "ALL" ? status : null,
      }),
      listAllocations(db, { actor, status: "APPROVED" }),
      listEarmarks(db, { actor, status: "APPROVED" }),
      db.concern.findMany({
        where: { status: { notIn: ["CLOSED"] } },
        orderBy: { id: "desc" },
        take: 50,
        select: { id: true, caseNumber: true, title: true },
      }),
      userCan(user.role.key, "treasury.disbursement.prepare"),
    ]);

  const filters = [
    "ALL",
    "DRAFT",
    "SUBMITTED",
    "CERTIFIED",
    "APPROVED",
    "RELEASED",
    "LIQUIDATED",
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t.disbursementsTitle} description={t.disbursementsLead} />

      {canPrepare && allocations.length > 0 && (
        <Card title={t.newVoucher}>
          <VoucherForm
            allocations={allocations.map((allocation) => ({
              id: allocation.id,
              label: allocation.label,
              coaCode: allocation.coaCode,
              available: allocation.available,
            }))}
            earmarks={approvedEarmarks.map((earmark) => ({
              id: earmark.id,
              code: earmark.code,
              purpose: earmark.purpose,
              amount: earmark.amount,
              committed: earmark.committed,
            }))}
            caseOptions={openCases}
            locale={locale}
          />
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        {filters.map((filter) => (
          <Button
            key={filter}
            href={
              filter === "ALL"
                ? "/treasury/disbursements"
                : `/treasury/disbursements?status=${filter}`
            }
            size="sm"
            variant={
              (status ?? "ALL") === filter ? "primary" : "outline"
            }
          >
            {filter}
          </Button>
        ))}
      </div>

      {vouchers.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-subtle">{t.noEntries}</p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {vouchers.map((voucher) => (
            <li key={voucher.id}>
              <Card className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-ink-subtle">
                    {voucher.voucherNumber ?? `#${voucher.id}`}
                  </span>
                  <Badge tone={TONES[voucher.status] ?? "neutral"}>
                    {voucher.statusLabel}
                  </Badge>
                  <span className="text-sm font-semibold text-ink">
                    {formatPeso(voucher.amount)}
                  </span>
                  {voucher.liquidationState !== "NOT_DUE" &&
                    voucher.status === "RELEASED" && (
                      <Badge tone="amber">{voucher.liquidationState}</Badge>
                    )}
                </div>
                <p className="text-sm text-ink-muted">{voucher.payee}</p>
                <p className="text-xs text-ink-subtle">
                  {voucher.particulars}
                </p>
                <p className="text-xs text-ink-subtle">
                  {voucher.coaCode} · {voucher.fundSourceCode}
                  {voucher.earmarkCode ? ` · ${voucher.earmarkCode}` : ""}
                  {voucher.caseNumber ? ` · ${voucher.caseNumber}` : ""} ·{" "}
                  {formatDateTime(voucher.preparedAt)}
                </p>
                <div>
                  <Button
                    href={`/treasury/disbursements/${voucher.id}`}
                    size="sm"
                    variant="outline"
                  >
                    {t.open}
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
