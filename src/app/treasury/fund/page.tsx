import type { Metadata } from "next";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StepGuide } from "@/components/cases/step-guide";
import { FundCaseForm } from "@/components/treasury/fund-case-form";
import { formatDate } from "@/lib/format";
import { formatPeso } from "@/lib/cases/manpower";
import { statusLabel } from "@/lib/cases/workflow";
import { db } from "@/lib/db";
import { requirePermission, userCan } from "@/lib/auth/session";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";
import {
  compareFundingQueue,
  rankFundingOptions,
} from "@/lib/treasury/funding-guide";
import {
  listAllocations,
  listCasesAwaitingFunding,
} from "@/lib/treasury/query";

export const metadata: Metadata = {
  title: "Fund a case",
};

export const dynamic = "force-dynamic";

/**
 * The guided funding flow: the treasury's answer to "approve the budget so a
 * resident's work can start".
 *
 * Before this page, funding a case meant arriving at the generic earmark form
 * and re-deriving the decision from its dropdowns: which case, how much is it
 * short (a number on a case screen the treasurer cannot even open), and which
 * of a dozen COA-coded budget lines should pay. Here the case arrives with its
 * own numbers, one budget is recommended — the case's own office's money
 * first, barangay-wide next — and the proposal is prefilled, so the whole job
 * is one review and one click. The card also says whose desk the money sits
 * on once proposed, because that approval, not the proposal, is what reserves
 * it.
 *
 * `?concernId=` (from a case's funding panel) anchors and highlights that
 * case's card.
 */
export default async function TreasuryFundCasePage({
  searchParams,
}: {
  searchParams: Promise<{ concernId?: string }>;
}) {
  const user = await requirePermission("treasury.balance.view");
  const params = await searchParams;
  const locale = await getLocale();
  const desk = copy[locale].revamp.treasuryDesk;
  const t = desk.fundCase;
  const actor = {
    id: user.id,
    roleKey: user.role.key,
    officeId: user.officeId ?? null,
  };

  const [cases, allocations, canPrepare] = await Promise.all([
    listCasesAwaitingFunding(db),
    listAllocations(db, { actor, status: "APPROVED", take: 200 }),
    userCan(user.role.key, "treasury.earmark.prepare"),
  ]);

  const queue = [...cases].sort((a, b) =>
    compareFundingQueue(
      {
        waitingForBudget: a.waitingForBudget,
        waitingSince: a.awaitingBudgetAt ?? a.submittedAt,
      },
      {
        waitingForBudget: b.waitingForBudget,
        waitingSince: b.awaitingBudgetAt ?? b.submittedAt,
      }
    )
  );

  // The queue the funding decision is for. PROPOSED_PENDING stays visible —
  // with an amber card, so "where is case X?" is answered here rather than in
  // the Captain's queue.
  const actionable = queue.filter(
    (row) => row.state === "NEEDS_MONEY" || row.state === "PROPOSED_PENDING"
  );
  const notReady = queue.filter(
    (row) => row.state === "NEEDS_ESTIMATE" || row.state === "COVERED"
  );

  const presetConcernId = Number(params.concernId ?? "");
  const highlightId = Number.isInteger(presetConcernId)
    ? actionable.find((row) => row.concernId === presetConcernId)?.concernId ??
      null
    : null;

  const allocationOptions = allocations.map((allocation) => ({
    allocationId: allocation.id,
    label: allocation.label,
    coaCode: allocation.coaCode,
    coaName: allocation.coaName,
    fundSourceCode: allocation.fundSourceCode,
    fundSourceName: allocation.fundSourceName,
    fiscalYear: allocation.fiscalYear,
    officeId: allocation.officeId,
    available: allocation.available,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title={t.title}
        description={t.lead}
        actions={
          <Button href="/treasury/earmarks" size="sm" variant="outline">
            {desk.earmarksTitle}
          </Button>
        }
      />

      <Card title={t.howTitle} description={t.howLead}>
        <StepGuide steps={t.howSteps} />
      </Card>

      {actionable.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-subtle">{t.queueEmpty}</p>
        </Card>
      ) : (
        <section className="space-y-3">
          <div className="space-y-1">
            <h2 className="text-subtitle text-ink">{t.queueTitle}</h2>
            <p className="text-sm text-ink-subtle">{t.queueLead}</p>
          </div>
          {actionable.map((row) => {
            const highlighted = row.concernId === highlightId;
            return (
              <Card
                key={row.concernId}
                className={highlighted ? "border-brand-600 ring-1 ring-brand-600/30" : undefined}
              >
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        id={`case-${row.concernId}`}
                        className="font-mono text-sm font-semibold text-ink"
                      >
                        {row.caseNumber}
                      </span>
                      <StatusBadge
                        status={row.status}
                        label={statusLabel(row.status)}
                      />
                      {row.waitingForBudget && (
                        <Badge tone="amber">{desk.caseWaitingForBudget}</Badge>
                      )}
                    </div>
                    <p className="text-sm text-ink">{row.title}</p>
                    <p className="text-xs text-ink-subtle">
                      {t.officeLabel}:{" "}
                      {row.officeName ?? t.noOffice} ·{" "}
                      {t.waitingSince.replaceAll(
                        "{date}",
                        formatDate(row.awaitingBudgetAt ?? row.submittedAt)
                      )}
                    </p>
                  </div>

                  {row.state === "PROPOSED_PENDING" ? (
                    <p className="rounded-control border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                      {t.statePending.replaceAll(
                        "{amount}",
                        formatPeso(row.proposed)
                      )}
                    </p>
                  ) : canPrepare ? (
                    <>
                      {row.proposed > 0 && (
                        <p className="text-xs text-ink-subtle">
                          {t.statePendingPartial.replaceAll(
                            "{amount}",
                            formatPeso(row.proposed)
                          )}
                        </p>
                      )}
                      <FundCaseForm
                        facts={{
                          concernId: row.concernId,
                          caseNumber: row.caseNumber,
                          title: row.title,
                          officeName: row.officeName,
                          estimate: row.estimate,
                          setAside: row.setAside,
                          proposed: row.proposed,
                          uncommitted: row.uncommitted,
                        }}
                        options={rankFundingOptions({
                          shortfall: row.uncommitted,
                          caseOfficeId: row.officeId,
                          allocations: allocationOptions,
                        })}
                        hasAllocations={allocations.length > 0}
                        locale={locale}
                      />
                    </>
                  ) : (
                    <p className="text-sm text-ink-subtle">
                      {desk.fundingNeedsMore.replaceAll(
                        "{shortfall}",
                        formatPeso(row.shortfall)
                      )}
                    </p>
                  )}
                </div>
              </Card>
            );
          })}
        </section>
      )}

      {notReady.length > 0 && (
        <section className="space-y-3">
          <div className="space-y-1">
            <h2 className="text-subtitle text-ink">{t.notReadyTitle}</h2>
            <p className="text-sm text-ink-subtle">{t.notReadyLead}</p>
          </div>
          <Card>
            <ul className="divide-y divide-line">
              {notReady.map((row) => (
                <li key={row.concernId} className="space-y-1 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-ink-subtle">
                      {row.caseNumber}
                    </span>
                    <StatusBadge
                      status={row.status}
                      label={statusLabel(row.status)}
                    />
                    <span className="text-sm text-ink">{row.title}</span>
                  </div>
                  <p className="text-xs text-ink-subtle">
                    {row.state === "NEEDS_ESTIMATE"
                      ? t.stateNeedsEstimate
                      : t.stateCovered}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}
    </div>
  );
}
