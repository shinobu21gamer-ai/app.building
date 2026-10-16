import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/session";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/dashboard/stat-card";
import { BarChart, type BarItem } from "@/components/dashboard/bar-chart";
import { DonutChart } from "@/components/dashboard/donut-chart";
import { getAdminDashboard } from "@/lib/dashboards/admin";
import { statusLabel } from "@/lib/cases/workflow";
import { MaintenanceActions } from "@/components/admin/maintenance-actions";
import { StepGuide } from "@/components/cases/step-guide";
import { AlertComposer } from "@/components/admin/alert-composer";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { DeskGuide } from "@/components/portals/desk-guide";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";

export const metadata: Metadata = {
  title: "Administrator",
};

const STATUS_COLORS: Record<string, string> = {
  SUBMITTED: "#0284c7",
  ASSIGNED: "#7c3aed",
  UNDER_ASSESSMENT: "#c026d3",
  AWAITING_BUDGET: "#ca8a04",
  IN_PROGRESS: "#d97706",
  RESOLVED: "#059669",
  CLOSED: "#64748b",
};

const PRIORITY_TONES: Record<string, BarItem["tone"]> = {
  LOW: "slate",
  MEDIUM: "sky",
  HIGH: "amber",
  CRITICAL: "red",
  UNASSESSED: "slate",
};

function formatHours(value: number | null): string {
  if (value === null) return "—";
  return `${value} h`;
}

export default async function AdminPage() {
  const user = await requireRole(["ADMIN"]);
  const locale = await getLocale();
  const t = copy[locale].admin;
  const flowCopy = copy[locale].flow;
  const dashboard = await getAdminDashboard();
  const {
    totals,
    byStatus,
    byPriority,
    byCategory,
    byOffice,
    processingTime,
    crew,
  } = dashboard;

  return (
    <div className="space-y-8">
      <PageHeader
        title={t.welcome.replace("{name}", user.firstName)}
        description={t.overview}
      />

      <div className="flex flex-wrap gap-2">
        <Button href="/admin/validation" size="sm">
          {t.startValidation}
        </Button>
        <Button href="/admin/users" size="sm" variant="outline">
          {t.startUsers}
        </Button>
        <Button href="/admin/crew" size="sm" variant="outline">
          {t.startCrew}
        </Button>
      </div>

      <div className="stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t.totalCases} value={totals.total} />
        <StatCard label={t.resolvedClosed} value={totals.resolved} />
        <StatCard label={t.unresolved} value={totals.unresolved} />
        <StatCard
          label={t.crewDeployed}
          value={crew.crewDeployed}
          hint={t.crewPlannedHint.replace("{planned}", String(crew.plannedCrew))}
        />
        <StatCard
          label={t.crewShortfall}
          value={crew.shortfallCases}
          hint={t.crewShortfallHint.replace("{cases}", String(crew.plannedCases))}
        />
        <StatCard
          label={t.avgProcessing}
          value={formatHours(processingTime.averageHours)}
          hint={
            processingTime.sampleSize === 1
              ? t.measuredOne
              : t.measuredMany.replace(
                  "{count}",
                  String(processingTime.sampleSize)
                )
          }
        />
      </div>

      <Card title={flowCopy.guide.adminTitle} description={flowCopy.guide.adminLead}>
        <div className="space-y-4">
          <StepGuide
            steps={[
              {
                title: flowCopy.steps.CHECK.title,
                detail: flowCopy.steps.CHECK.lead,
                who: flowCopy.steps.CHECK.who,
                yoursLabel: flowCopy.youDoThis,
                highlight: true,
              },
              {
                title: flowCopy.steps.VALIDATE.title,
                detail: flowCopy.steps.VALIDATE.lead,
                who: flowCopy.steps.VALIDATE.who,
                yoursLabel: flowCopy.youDoThis,
                highlight: true,
              },
            ]}
          />
          <Button href="/admin/validation">{flowCopy.guide.adminAction}</Button>
          <StepGuide
            title={flowCopy.guide.othersTitle}
            steps={(
              [
                flowCopy.steps.ASSESS,
                flowCopy.steps.FUND,
                flowCopy.steps.CREW,
                flowCopy.steps.START,
                flowCopy.steps.WORK,
                flowCopy.steps.VERIFY,
                flowCopy.steps.CLOSE,
              ] as const
            ).map((step) => ({
              title: step.title,
              detail: step.lead,
              who: step.who,
              yoursLabel: flowCopy.notYouTitle,
            }))}
          />
        </div>
      </Card>

      <AlertComposer locale={locale} />

      <div className="stagger grid gap-6 lg:grid-cols-2">
        <Card title={t.byStatusChart} description={t.byStatusChartDesc}>
          <DonutChart
            centerLabel={t.casesLabel}
            segments={byStatus.map((entry) => ({
              label: statusLabel(entry.status),
              value: entry.count,
              color: STATUS_COLORS[entry.status],
            }))}
          />
        </Card>

        <Card title={t.byPriorityChart} description={t.byPriorityChartDesc}>
          <BarChart
            items={byPriority.map((entry) => ({
              label: statusLabel(entry.level),
              value: entry.count,
              tone: PRIORITY_TONES[entry.level],
            }))}
          />
        </Card>

        <Card title={t.byCategoryChart} description={t.byCategoryChartDesc}>
          <BarChart
            items={byCategory.map((entry) => ({
              label: entry.name,
              value: entry.count,
              tone: "brand",
            }))}
            emptyLabel={t.noSubmitted}
          />
        </Card>

        <Card title={t.byOfficeChart} description={t.byOfficeChartDesc}>
          <BarChart
            items={byOffice.map((entry) => ({
              label: entry.name,
              value: entry.count,
              tone: "violet",
            }))}
            emptyLabel={t.noAssigned}
          />
        </Card>
      </div>

      <Card title={t.housekeepingTitle} description={t.housekeepingDesc}>
        <MaintenanceActions locale={locale} />
      </Card>

      <Card title={t.processingTitle} description={t.processingDesc}>
        {processingTime.sampleSize === 0 ? (
          <EmptyState title={t.noTimestamps} />
        ) : (
          <dl className="stagger grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-sm text-ink-subtle">{t.average}</dt>
              <dd className="mt-1 text-2xl font-bold text-ink">
                {formatHours(processingTime.averageHours)}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-ink-subtle">{t.fastest}</dt>
              <dd className="mt-1 text-2xl font-bold text-ink">
                {formatHours(processingTime.fastestHours)}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-ink-subtle">{t.slowest}</dt>
              <dd className="mt-1 text-2xl font-bold text-ink">
                {formatHours(processingTime.slowestHours)}
              </dd>
            </div>
          </dl>
        )}
      </Card>

      <DeskGuide
        title={t.howToTitle}
        lead={t.howToLead}
        steps={t.howToSteps}
        mistakesTitle={copy[locale].revamp.howTo.ifWrong}
        mistakes={t.howToIfWrong}
        helpLabel={copy[locale].revamp.howTo.help}
        hideLabel={copy[locale].revamp.howTo.hide}
        showLabel={copy[locale].revamp.howTo.show}
        storageKey="br-guide-admin"
        defaultOpen={totals.unresolved === 0}
      />
    </div>
  );
}
