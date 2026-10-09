import type { Metadata } from "next";
import { Building2, Download, GitBranch, Settings2, SlidersHorizontal, Tags, UserRound, Users } from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/dashboard/stat-card";
import { BarChart, type BarItem } from "@/components/dashboard/bar-chart";
import { DonutChart } from "@/components/dashboard/donut-chart";
import { getAdminDashboard } from "@/lib/dashboards/admin";
import { statusLabel } from "@/lib/cases/workflow";
import { MaintenanceActions } from "@/components/admin/maintenance-actions";
import { AlertComposer } from "@/components/admin/alert-composer";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";

export const metadata: Metadata = {
  title: "Administrator",
};

const STATUS_COLORS: Record<string, string> = {
  SUBMITTED: "#0284c7",
  ASSIGNED: "#7c3aed",
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
  const dashboard = await getAdminDashboard();
  const { totals, byStatus, byPriority, byCategory, byOffice, processingTime } =
    dashboard;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            {t.welcome.replace("{name}", user.firstName)}
          </h1>
          <p className="mt-1 text-sm text-slate-600">{t.overview}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button href="/admin/users" variant="outline" size="sm">
            <Users size={14} aria-hidden="true" />
            {t.navUsers}
          </Button>
          <Button href="/admin/officials" variant="outline" size="sm">
            <UserRound size={14} aria-hidden="true" />
            {t.navOfficials}
          </Button>
          <Button href="/admin/offices" variant="outline" size="sm">
            <Building2 size={14} aria-hidden="true" />
            {t.navOffices}
          </Button>
          <Button href="/admin/categories" variant="outline" size="sm">
            <Tags size={14} aria-hidden="true" />
            {t.navCategories}
          </Button>
          <Button href="/admin/priority" variant="outline" size="sm">
            <SlidersHorizontal size={14} aria-hidden="true" />
            {t.navPriority}
          </Button>
          <Button href="/admin/routing" variant="outline" size="sm">
            <GitBranch size={14} aria-hidden="true" />
            {t.navRouting}
          </Button>
          <Button href="/admin/settings" variant="outline" size="sm">
            <Settings2 size={14} aria-hidden="true" />
            {t.navSettings}
          </Button>
          <Button href="/admin/reports" variant="secondary" size="sm">
            <Download size={14} aria-hidden="true" />
            {t.navReports}
          </Button>
          <MaintenanceActions locale={locale} />
        </div>
      </div>

      <div className="stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t.totalCases} value={totals.total} />
        <StatCard label={t.resolvedClosed} value={totals.resolved} />
        <StatCard label={t.unresolved} value={totals.unresolved} />
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

      <Card title={t.processingTitle} description={t.processingDesc}>
        {processingTime.sampleSize === 0 ? (
          <p className="py-6 text-center text-sm text-slate-600">
            {t.noTimestamps}
          </p>
        ) : (
          <dl className="stagger grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-sm text-slate-500">{t.average}</dt>
              <dd className="mt-1 text-2xl font-bold text-slate-900">
                {formatHours(processingTime.averageHours)}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-slate-500">{t.fastest}</dt>
              <dd className="mt-1 text-2xl font-bold text-slate-900">
                {formatHours(processingTime.fastestHours)}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-slate-500">{t.slowest}</dt>
              <dd className="mt-1 text-2xl font-bold text-slate-900">
                {formatHours(processingTime.slowestHours)}
              </dd>
            </div>
          </dl>
        )}
      </Card>
    </div>
  );
}
