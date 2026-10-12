import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EarmarkActions } from "@/components/treasury/earmark-actions";
import { EarmarkForm } from "@/components/treasury/earmark-form";
import { formatPeso } from "@/lib/cases/manpower";
import { formatDateTime } from "@/lib/format";
import { db } from "@/lib/db";
import { requirePermission, userCan } from "@/lib/auth/session";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";
import { listAllocations, listEarmarks } from "@/lib/treasury/query";

export const metadata: Metadata = {
  title: "Earmarks",
};

export const dynamic = "force-dynamic";

const TONES: Record<string, "sky" | "amber" | "green" | "gray"> = {
  PROPOSED: "sky",
  APPROVED: "amber",
  RELEASED: "green",
  CANCELLED: "gray",
};

/**
 * Money set aside before it is spent. An earmark is what lets a case wait in
 * AWAITING_BUDGET in the knowledge that the funds are actually there.
 */
export default async function TreasuryEarmarksPage() {
  const user = await requirePermission("treasury.balance.view");
  const locale = await getLocale();
  const t = copy[locale].revamp.treasuryDesk;
  const actor = {
    id: user.id,
    roleKey: user.role.key,
    officeId: user.officeId ?? null,
  };

  const [earmarks, allocations, openCases, canPrepare, canApprove] =
    await Promise.all([
      listEarmarks(db, { actor }),
      listAllocations(db, { actor, status: "APPROVED" }),
      db.concern.findMany({
        where: { status: { notIn: ["CLOSED", "RESOLVED"] } },
        orderBy: { id: "desc" },
        take: 50,
        select: { id: true, caseNumber: true, title: true },
      }),
      userCan(user.role.key, "treasury.earmark.prepare"),
      userCan(user.role.key, "treasury.earmark.approve"),
    ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-title text-ink sm:text-display">{t.earmarksTitle}</h1>
        <p className="mt-1 text-sm text-ink-muted">{t.earmarksLead}</p>
      </div>

      {canPrepare && allocations.length > 0 && (
        <Card title={t.newEarmark}>
          <EarmarkForm
            allocations={allocations.map((allocation) => ({
              id: allocation.id,
              label: allocation.label,
              coaCode: allocation.coaCode,
              fundSourceCode: allocation.fundSourceCode,
              available: allocation.available,
            }))}
            caseOptions={openCases}
            locale={locale}
          />
        </Card>
      )}

      {earmarks.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-subtle">{t.noEntries}</p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {earmarks.map((earmark) => (
            <li key={earmark.id}>
              <Card className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-ink-subtle">
                    {earmark.code ?? `#${earmark.id}`}
                  </span>
                  <Badge tone={TONES[earmark.status] ?? "neutral"}>
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
                  {earmark.coaCode} · {earmark.fundSourceCode} · FY{" "}
                  {earmark.fiscalYear}
                  {earmark.officeName ? ` · ${earmark.officeName}` : ""} ·{" "}
                  {formatDateTime(earmark.preparedAt)}
                </p>
                {earmark.caseNumber && (
                  <p className="text-xs text-ink-muted">
                    {t.linkedCase}: {earmark.caseNumber} — {earmark.caseTitle}
                  </p>
                )}
                {earmark.cancelReason && (
                  <p className="text-xs text-red-600">
                    {t.cancelReason} {earmark.cancelReason}
                  </p>
                )}
                <EarmarkActions
                  earmarkId={earmark.id}
                  status={earmark.status}
                  canApprove={canApprove}
                  canCancel={canPrepare}
                  locale={locale}
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    href={`/treasury/budgets/${earmark.allocationId}`}
                    size="sm"
                    variant="ghost"
                  >
                    {t.navBudgets}
                  </Button>
                  {earmark.concernId && (
                    <Button
                      href={`/official/concerns/${earmark.concernId}`}
                      size="sm"
                      variant="ghost"
                    >
                      {t.linkedCase}
                    </Button>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
