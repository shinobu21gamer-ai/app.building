import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/dashboard/stat-card";
import { PageHeader } from "@/components/ui/page-header";
import { DeskGuide } from "@/components/portals/desk-guide";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { CLOSE_VERIFICATION_STATUS } from "@/lib/cases/workflow";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";
import { listEscalationQueue } from "@/lib/sla/escalation";

export const metadata: Metadata = {
  title: "Captain",
};

export const dynamic = "force-dynamic";

/**
 * The Captain's home: the work that is actually waiting on them today.
 *
 * Approvals, the close queue, escalations and reports already have desks.
 * This page used to list raw permission keys and "coming soon" modules
 * instead of those queues, so a Captain signing in could not see the
 * decisions sitting in front of them.
 */
export default async function CaptainPage() {
  const user = await requirePermission("sla.escalation.view");
  const locale = await getLocale();
  const t = copy[locale].revamp.captain;
  const desk = copy[locale].revamp.treasuryDesk;
  const sla = copy[locale].revamp.slaDesk;

  const [
    readyToClose,
    resolved,
    allocations,
    earmarks,
    vouchers,
    escalations,
  ] = await Promise.all([
    db.concern.count({
      where: {
        status: "RESOLVED",
        resolutions: {
          some: {
            verifiedAt: { not: null },
            verificationStatus: CLOSE_VERIFICATION_STATUS,
          },
        },
      },
    }),
    db.concern.count({ where: { status: "RESOLVED" } }),
    db.budgetAllocation.count({ where: { status: "DRAFT" } }),
    db.budgetEarmark.count({ where: { status: "PROPOSED" } }),
    db.disbursement.count({ where: { status: "CERTIFIED" } }),
    listEscalationQueue({ roleKeys: ["CAPTAIN"], status: "OPEN", limit: 1 }),
  ]);

  const needVerify = Math.max(0, resolved - readyToClose);
  const approvalTotal = allocations + earmarks + vouchers;

  const stats = [
    {
      label: t.statReadyToClose,
      value: readyToClose,
      hint: t.statReadyToCloseHint,
    },
    {
      label: t.statNeedVerify,
      value: needVerify,
      hint: t.statNeedVerifyHint,
    },
    {
      label: t.statApprovals,
      value: approvalTotal,
      hint: t.statApprovalsHint,
    },
    {
      label: t.statEscalations,
      value: escalations.counts.open,
      hint: t.statEscalationsHint,
    },
  ];

  const approvalRows = [
    { label: desk.awaitingApprovalAllocations, count: allocations },
    { label: desk.awaitingApprovalEarmarks, count: earmarks },
    { label: desk.awaitingApprovalVouchers, count: vouchers },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title={t.welcome.replace("{name}", user.firstName)}
        description={t.lead}
      />

      <div className="stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <StatCard
            key={stat.label}
            label={stat.label}
            value={stat.value}
            hint={stat.hint}
          />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t.queueApprovals}>
          <ul className="divide-y divide-line">
            {approvalRows.map((row) => (
              <li
                key={row.label}
                className="flex items-center justify-between gap-3 py-2"
              >
                <span className="text-sm text-ink-muted">{row.label}</span>
                <span className="text-sm font-semibold tabular-nums text-ink">
                  {row.count}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-4">
            <Button href="/captain/approvals" size="sm">
              {t.openApprovals}
            </Button>
          </div>
        </Card>

        <Card title={t.queueClosure} description={t.closeQueueLead}>
          <dl className="space-y-2 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-ink-muted">{t.statReadyToClose}</dt>
              <dd className="font-semibold tabular-nums text-ink">
                {readyToClose}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-ink-muted">{t.statNeedVerify}</dt>
              <dd className="font-semibold tabular-nums text-ink">
                {needVerify}
              </dd>
            </div>
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button href="/captain/closure" size="sm">
              {t.closeQueueTitle}
            </Button>
            <Button href="/captain/escalations" size="sm" variant="outline">
              {sla.captainTitle}
            </Button>
            <Button href="/captain/reports" size="sm" variant="outline">
              {copy[locale].revamp.reports.title}
            </Button>
          </div>
        </Card>
      </div>

      <DeskGuide
        title={t.guideTitle}
        lead={t.guideLead}
        steps={t.guideSteps}
        mistakesTitle={copy[locale].revamp.howTo.ifWrong}
        mistakes={t.ifWrong}
        helpLabel={copy[locale].revamp.howTo.help}
        hideLabel={copy[locale].revamp.howTo.hide}
        showLabel={copy[locale].revamp.howTo.show}
        storageKey="br-guide-captain"
        defaultOpen={
          approvalTotal === 0 &&
          readyToClose === 0 &&
          needVerify === 0 &&
          escalations.counts.open === 0
        }
      />
    </div>
  );
}
