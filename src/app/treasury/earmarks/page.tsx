import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EarmarkActions } from "@/components/treasury/earmark-actions";
import { EarmarkForm } from "@/components/treasury/earmark-form";
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
import {
  briefForEarmarkRow,
  earmarkQueueRank,
  isAwaitingDecision,
} from "@/lib/treasury/approval";
import {
  earmarkStatusCounts,
  fundedAmountsByConcern,
  listAllocations,
  listEarmarks,
} from "@/lib/treasury/query";

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
 * The queue filters. Each one names a decision state rather than a raw database
 * status, so the treasurer can answer "what is waiting on me?" without knowing
 * the earmark lifecycle by heart.
 */
type FilterKey = "NEEDS" | "SET_ASIDE" | "ENDED" | "ALL";

const FILTERS: ReadonlyArray<{
  key: FilterKey;
  /** The earmark statuses this tab shows; null means every status. */
  statuses: readonly string[] | null;
}> = [
  { key: "NEEDS", statuses: ["PROPOSED"] },
  { key: "SET_ASIDE", statuses: ["APPROVED", "RELEASED"] },
  { key: "ENDED", statuses: ["CANCELLED"] },
  { key: "ALL", statuses: null },
];

function filterKey(value: string | undefined): FilterKey {
  return FILTERS.some((filter) => filter.key === value)
    ? (value as FilterKey)
    : "NEEDS";
}

/**
 * Money set aside before it is spent. An earmark is what lets a case wait in
 * AWAITING_BUDGET in the knowledge that the funds are actually there.
 *
 * The page is ordered as a decision queue rather than a register dump: what
 * still needs a decision comes first, and inside that what this reader can
 * decide comes before what is waiting on somebody else, and a case sitting in
 * AWAITING_BUDGET outranks the rest because a resident is waiting on it. Each
 * card carries the approval brief, so "is this the right money for the right
 * concern?" is answered on the card instead of by opening three other screens.
 *
 * `?concernId=` arrives from a case's funding panel and opens the proposal form
 * with that case already picked and the shortfall already filled in.
 */
export default async function TreasuryEarmarksPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; concernId?: string }>;
}) {
  const user = await requirePermission("treasury.balance.view");
  const params = await searchParams;
  const locale = await getLocale();
  const t = copy[locale].revamp.treasuryDesk;
  const actor = {
    id: user.id,
    roleKey: user.role.key,
    officeId: user.officeId ?? null,
  };
  const activeFilter = filterKey(params.status);
  // `filterKey` always returns a key FILTERS holds, so the lookup only has to
  // satisfy the type: never silently hide the whole register.
  const statuses = FILTERS.find((item) => item.key === activeFilter)?.statuses;
  // Filtering in the database rather than after the fetch matters here: the
  // register is capped, and the earmarks that get dropped would be the oldest —
  // precisely the proposals a case has been stuck on longest.
  const singleStatus = statuses?.length === 1 ? statuses[0] : null;

  const [earmarks, statusCounts, allocations, openCases, canPrepare, canApprove] =
    await Promise.all([
      // The brief needs the live allocation balance and the set-aside total per
      // case; both are loaded in the same call so the cards can show them.
      listEarmarks(db, {
        actor,
        status: singleStatus,
        take: 200,
        includeApprovalContext: true,
      }),
      earmarkStatusCounts(db, { actor }),
      listAllocations(db, { actor, status: "APPROVED" }),
      db.concern.findMany({
        where: { status: { notIn: ["CLOSED", "RESOLVED"] } },
        orderBy: { id: "desc" },
        take: 50,
        select: {
          id: true,
          caseNumber: true,
          title: true,
          status: true,
          // The amount to reserve is the case's own cost estimate; showing it
          // here is what makes the treasury's decision an informed one.
          caseAssessment: {
            select: { totalCost: true, laborCost: true, workersNeeded: true },
          },
          // Where the money goes and who will spend it — the form shows this
          // as the "where this money goes" brief.
          assignedOffice: { select: { name: true, headOfficer: true } },
          assignedOfficial: { select: { firstName: true, lastName: true } },
        },
      }),
      userCan(user.role.key, "treasury.earmark.prepare"),
      userCan(user.role.key, "treasury.earmark.approve"),
    ]);

  // What is already set aside for each of those cases, so the picker can say
  // what still has to be covered rather than making the treasurer go hunting.
  const setAside = await fundedAmountsByConcern(
    db,
    openCases.map((item) => item.id)
  );
  // Cases waiting in AWAITING_BUDGET first: those are the ones the money is
  // actually being reserved for right now.
  const caseOptions = [...openCases]
    .sort((a, b) => {
      const rank = (status: string) => (status === "AWAITING_BUDGET" ? 0 : 1);
      return rank(a.status) - rank(b.status) || b.id - a.id;
    })
    .map((item) => ({
      id: item.id,
      caseNumber: item.caseNumber,
      title: item.title,
      estimate:
        item.caseAssessment === null
          ? null
          : Number(item.caseAssessment.totalCost ?? 0),
      laborCost:
        item.caseAssessment === null || item.caseAssessment.laborCost === null
          ? null
          : Number(item.caseAssessment.laborCost),
      workersNeeded: item.caseAssessment?.workersNeeded ?? null,
      officeName: item.assignedOffice?.name ?? null,
      officeHead: item.assignedOffice?.headOfficer ?? null,
      officialName: item.assignedOfficial
        ? `${item.assignedOfficial.firstName} ${item.assignedOfficial.lastName}`.trim()
        : null,
      setAside: setAside.get(item.id) ?? 0,
      waitingForBudget: item.status === "AWAITING_BUDGET",
    }));

  const briefs = new Map(
    earmarks.map((row) => [
      row.id,
      briefForEarmarkRow(row, { id: actor.id, canApprove }),
    ])
  );

  // Counted across the whole register, not just the fetched page.
  const waitingCount = [...statusCounts.entries()]
    .filter(([status]) => isAwaitingDecision(status))
    .reduce((sum, [, count]) => sum + count, 0);
  const countFor = (keys: readonly string[]) =>
    keys.reduce((sum, key) => sum + (statusCounts.get(key) ?? 0), 0);
  // Of what is on screen, how many this reader may actually decide.
  const decidableCount = earmarks.filter(
    (row) => briefs.get(row.id)?.canDecide === true
  ).length;

  const visible = earmarks
    .filter(
      (row) => statuses === null || statuses === undefined || statuses.includes(row.status)
    )
    .sort((a, b) => {
      const briefA = briefs.get(a.id);
      const briefB = briefs.get(b.id);
      const rank =
        earmarkQueueRank({
          status: a.status,
          canDecide: briefA?.canDecide ?? false,
          caseWaitingForBudget: briefA?.caseWaitingForBudget ?? false,
        }) -
        earmarkQueueRank({
          status: b.status,
          canDecide: briefB?.canDecide ?? false,
          caseWaitingForBudget: briefB?.caseWaitingForBudget ?? false,
        });
      // Longest queued first: an earmark nobody has looked at should not sit
      // behind one proposed five minutes ago.
      return rank !== 0 ? rank : a.preparedAt.getTime() - b.preparedAt.getTime();
    });

  // Arriving from a case's funding panel: open the form on that case, already
  // sized to what the case is still short.
  const presetConcernId = Number(params.concernId ?? "");
  const preset = Number.isInteger(presetConcernId)
    ? caseOptions.find((option) => option.id === presetConcernId) ?? null
    : null;
  const presetShortfall =
    preset === null || preset.estimate === null
      ? null
      : Math.max(0, Math.round((preset.estimate - preset.setAside) * 100) / 100);

  const filterLabels: Record<FilterKey, string> = {
    NEEDS: t.earmarkFilterNeedsDecision,
    SET_ASIDE: t.earmarkFilterSetAside,
    ENDED: t.earmarkFilterEnded,
    ALL: t.earmarkFilterAll,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t.earmarksTitle}
        description={t.earmarksLead}
        actions={
          <>
            {waitingCount > 0 && (
              <Badge tone="amber">
                {t.earmarkQueueCount.replace("{count}", String(waitingCount))}
              </Badge>
            )}
            <Button href="/treasury/fund" size="sm" variant="outline">
              {t.navFundCase}
            </Button>
          </>
        }
      />

      {canPrepare && allocations.length > 0 && (
        <Card
          title={t.newEarmark}
          description={
            preset
              ? `${preset.caseNumber} — ${preset.title}${
                  presetShortfall !== null && presetShortfall > 0
                    ? ` · ${t.fundingStillNeeded}: ${formatPeso(presetShortfall)}`
                    : ""
                }`
              : undefined
          }
        >
          <EarmarkForm
            allocations={allocations.map((allocation) => ({
              id: allocation.id,
              label: allocation.label,
              coaCode: allocation.coaCode,
              fundSourceCode: allocation.fundSourceCode,
              officeName: allocation.officeName,
              available: allocation.available,
            }))}
            caseOptions={caseOptions}
            presetConcernId={preset?.id ?? null}
            suggestedAmount={presetShortfall}
            defaultOpen={preset !== null}
            locale={locale}
          />
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((item) => {
          const isActive = item.key === activeFilter;
          const href =
            item.key === "NEEDS"
              ? "/treasury/earmarks"
              : `/treasury/earmarks?status=${item.key}`;
          return (
            <Button
              key={item.key}
              href={href}
              size="sm"
              variant={isActive ? "primary" : "outline"}
            >
              {filterLabels[item.key]}
              {(() => {
                const total =
                  item.statuses === null ? null : countFor(item.statuses);
                return total === null || total === 0 ? "" : ` (${total})`;
              })()}
            </Button>
          );
        })}
        {decidableCount > 0 && (
          <span className="text-xs text-ink-subtle">
            {t.earmarkNeedsYourDecision}: {decidableCount}
          </span>
        )}
      </div>

      {visible.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-subtle">
            {activeFilter === "NEEDS" ? t.earmarkQueueEmpty : t.noEntries}
          </p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {visible.map((earmark) => {
            const brief = briefs.get(earmark.id);
            if (!brief) return null;
            return (
              <li key={earmark.id}>
                <Card className="space-y-3">
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
                    {brief.canDecide && (
                      <Badge tone="green">{t.earmarkNeedsYourDecision}</Badge>
                    )}
                  </div>
                  <p className="text-sm text-ink-muted">{earmark.purpose}</p>

                  <EarmarkReview
                    earmark={earmarkReviewFacts(earmark)}
                    brief={brief}
                    locale={locale}
                  />

                  {earmark.cancelReason && (
                    <p className="text-xs text-red-600">
                      {t.cancelReason} {earmark.cancelReason}
                    </p>
                  )}

                  <EarmarkActions
                    earmarkId={earmark.id}
                    status={earmark.status}
                    brief={brief}
                    allocationLabel={earmark.allocationLabel}
                    caseNumber={earmark.caseNumber}
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
                  <p className="text-xs text-ink-subtle">
                    {formatDateTime(earmark.preparedAt)}
                  </p>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
