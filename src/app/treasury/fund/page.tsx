import type { Metadata } from "next";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StepGuide } from "@/components/cases/step-guide";
import { BudgetReviewCard } from "@/components/treasury/budget-review-card";
import { formatDate } from "@/lib/format";
import { formatPeso } from "@/lib/cases/manpower";
import { statusLabel } from "@/lib/cases/workflow";
import { db } from "@/lib/db";
import { requirePermission, userCan } from "@/lib/auth/session";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";
import {
  fundingMoneyTotals,
  rankFundingOptions,
} from "@/lib/treasury/funding-guide";
import { fundingQueue, listAllocations } from "@/lib/treasury/query";

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
/**
 * Where "Add a budget" lands: the guided allocation form, prefilled with what
 * this case is missing, so preparing the budget starts from the case's own
 * numbers instead of an empty form.
 */
function addBudgetHref(facts: {
  concernId: number;
  caseNumber: string;
  officeId: number | null;
  uncommitted: number;
}): string {
  const params = new URLSearchParams();
  if (facts.uncommitted > 0) {
    params.set("amount", facts.uncommitted.toFixed(2));
  }
  if (facts.officeId !== null) {
    params.set("office", String(facts.officeId));
  }
  params.set("case", facts.caseNumber);
  params.set("concern", String(facts.concernId));
  return `/treasury/budgets?${params.toString()}`;
}

function AddBudgetActions({
  href,
  label,
  howTo,
}: {
  href: string;
  label: string;
  howTo: string;
}) {
  return (
    <div className="space-y-2 rounded-control border border-line bg-surface px-3 py-2.5">
      <Button href={href} size="sm">
        {label}
      </Button>
      <p className="text-xs leading-relaxed text-ink-subtle">{howTo}</p>
    </div>
  );
}

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

  const [funding, allocations, canPrepare, canAddBudget] = await Promise.all([
    fundingQueue(db),
    listAllocations(db, { actor, status: "APPROVED", take: 200 }),
    userCan(user.role.key, "treasury.earmark.prepare"),
    userCan(user.role.key, "treasury.allocation.prepare"),
  ]);

  // Already in queue order: AWAITING_BUDGET first, then the longest wait.
  const queue = funding.rows;

  // The queue the funding decision is for. PROPOSED_PENDING stays visible —
  // with an amber card, so "where is case X?" is answered here rather than in
  // the Captain's queue.
  const actionable = queue.filter(
    (row) => row.state === "NEEDS_MONEY" || row.state === "PROPOSED_PENDING"
  );
  const notReady = queue.filter(
    (row) => row.state === "NEEDS_ESTIMATE" || row.state === "COVERED"
  );

  // What the cards below cost in total, totalled from exactly those rows — so
  // the headline cannot disagree with the cards it introduces. The treasurer's
  // first question on this page is not "how many cases?" but "how much money
  // is this?", and a proposal is a different conversation from a supplemental
  // appropriation.
  const cards = fundingMoneyTotals(actionable);

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
            <p className="pt-1 text-sm">
              <span className="font-semibold tabular-nums text-ink">
                {t.queueNeed
                  .replaceAll("{count}", String(cards.cases))
                  .replaceAll("{amount}", formatPeso(cards.need))}
              </span>
              <span className="text-ink-subtle">
                {" · "}
                {t.queueSplit
                  .replaceAll("{toPropose}", formatPeso(cards.toPropose))
                  .replaceAll("{pending}", formatPeso(cards.pending))}
              </span>
            </p>
          </div>
          {actionable.map((row) => {
            const highlighted = row.concernId === highlightId;
            const ranked = rankFundingOptions({
              shortfall: row.uncommitted,
              caseOfficeId: row.officeId,
              allocations: allocationOptions,
            });
            // One budget line, chosen for the reader: the case's own office
            // first, barangay-wide next — the card never shows a list.
            const best =
              ranked.find((entry) => entry.recommended) ?? ranked[0] ?? null;
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
                      {/* The amount, before the form explains it: this is the
                          figure the treasurer came to the page for. */}
                      <Badge tone={row.state === "PROPOSED_PENDING" ? "sky" : "amber"}>
                        {t.needBadge.replaceAll(
                          "{amount}",
                          formatPeso(row.shortfall)
                        )}
                      </Badge>
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

                  {/* What the case is about, in the resident's own words. */}
                  <p className="text-sm leading-relaxed text-ink-muted">
                    {row.description}
                  </p>

                  {/* The report: what the work costs, and what will be bought. */}
                  {row.breakdown && (
                    <div className="rounded-control border border-line bg-surface-sunken px-3 py-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                        {t.reportTitle}
                      </p>
                      <dl className="mt-1.5 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                        {(
                          [
                            [t.reportLabor, row.breakdown.labor],
                            [t.reportMaterials, row.breakdown.materials],
                            [t.reportEquipment, row.breakdown.equipment],
                            [t.reportOther, row.breakdown.other],
                          ] as Array<[string, number]>
                        ).map(([label, value]) => (
                          <div
                            key={label}
                            className="flex justify-between gap-3"
                          >
                            <dt className="text-ink-subtle">{label}</dt>
                            <dd className="font-medium tabular-nums text-ink">
                              {formatPeso(value)}
                            </dd>
                          </div>
                        ))}
                        <div className="flex justify-between gap-3 border-t border-line pt-1 sm:col-span-2">
                          <dt className="font-medium text-ink">
                            {t.reportTotal}
                          </dt>
                          <dd className="font-semibold tabular-nums text-ink">
                            {formatPeso(row.breakdown.total)}
                          </dd>
                        </div>
                      </dl>
                      {row.materials.length > 0 && (
                        <ul className="mt-2 divide-y divide-line border-t border-line pt-1 text-sm">
                          {row.materials.map((line, index) => (
                            <li
                              key={index}
                              className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1"
                            >
                              <span className="text-ink">
                                {line.name}
                                {line.quantity !== null && line.unit && (
                                  <span className="text-ink-subtle">
                                    {" "}
                                    · {line.quantity} {line.unit}
                                  </span>
                                )}
                                {line.unitPrice !== null && (
                                  <span className="text-ink-subtle">
                                    {" "}
                                    · {formatPeso(line.unitPrice)}{" "}
                                    {t.perUnit}
                                  </span>
                                )}
                              </span>
                              <span className="font-medium tabular-nums text-ink">
                                {formatPeso(line.amount)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}

                  {/* The money's home: which line pays, and how much is left on it. */}
                  {best && (
                    <p className="text-sm text-ink-muted">
                      {t.moneyFrom.replaceAll(
                        "{line}",
                        `${
                          best.option.officeId === null
                            ? t.moneyFromBarangay
                            : best.option.label
                        } · ${best.option.coaName} · FY${best.option.fiscalYear}`
                      ).replaceAll(
                        "{available}",
                        formatPeso(best.option.available)
                      )}
                    </p>
                  )}

                  {/* Where the money stands for this case. */}
                  <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                    <div className="flex gap-2">
                      <dt className="text-ink-subtle">
                        {t.caseEstimateLabel}
                      </dt>
                      <dd className="font-medium tabular-nums text-ink">
                        {row.estimate !== null
                          ? formatPeso(row.estimate)
                          : t.noEstimate}
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="text-ink-subtle">{t.setAsideLabel}</dt>
                      <dd className="font-medium tabular-nums text-ink">
                        {formatPeso(row.setAside)}
                      </dd>
                    </div>
                    {row.proposed > 0 && (
                      <div className="flex gap-2">
                        <dt className="text-ink-subtle">{t.pendingLabel}</dt>
                        <dd className="font-medium tabular-nums text-ink">
                          {formatPeso(row.proposed)}
                        </dd>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <dt className="text-ink-subtle">
                        {t.stillNeededLabel}
                      </dt>
                      <dd
                        className={`font-semibold tabular-nums ${
                          row.uncommitted > 0 ? "text-amber-700" : "text-emerald-700"
                        }`}
                      >
                        {formatPeso(row.uncommitted)}
                      </dd>
                    </div>
                  </dl>

                  {row.state === "PROPOSED_PENDING" ? (
                    <p className="rounded-control border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                      {t.statePending.replaceAll(
                        "{amount}",
                        formatPeso(row.proposed)
                      )}
                    </p>
                  ) : canPrepare ? (
                    best === null ? (
                      <div className="space-y-2">
                        <p className="rounded-control border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                          {t.noAllocations}
                        </p>
                        {canAddBudget && (
                          <AddBudgetActions
                            href={addBudgetHref({
                              concernId: row.concernId,
                              caseNumber: row.caseNumber,
                              officeId: row.officeId,
                              uncommitted: row.uncommitted,
                            })}
                            label={t.addBudget}
                            howTo={t.addBudgetHow}
                          />
                        )}
                      </div>
                    ) : (
                      <BudgetReviewCard
                        concernId={row.concernId}
                        caseNumber={row.caseNumber}
                        title={row.title}
                        uncommitted={row.uncommitted}
                        recommended={{
                          allocationId: best.option.allocationId,
                          label: best.option.label,
                          coaName: best.option.coaName,
                          fiscalYear: best.option.fiscalYear,
                          available: best.option.available,
                        }}
                        notFunded={
                          row.budgetDecision === null
                            ? null
                            : {
                                reason: row.budgetDecision.reason,
                                decidedByName: row.budgetDecision.decidedByName,
                                decidedAt: row.budgetDecision.decidedAt.toISOString(),
                              }
                        }
                        locale={locale}
                      />
                    )
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
                  {row.state === "COVERED" && row.estimate !== null && (
                    <p className="text-xs font-medium tabular-nums text-ink-muted">
                      {t.estimateChip.replaceAll(
                        "{amount}",
                        formatPeso(row.estimate)
                      )}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}
    </div>
  );
}
