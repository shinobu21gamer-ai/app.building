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
  const dashboard = await getAdminDashboard();
  const { totals, byStatus, byPriority, byCategory, byOffice, processingTime } =
    dashboard;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Welcome, {user.firstName}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Live system overview. Every figure is calculated from the database.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button href="/admin/users" variant="outline" size="sm">
            <Users size={14} aria-hidden="true" />
            Users
          </Button>
          <Button href="/admin/officials" variant="outline" size="sm">
            <UserRound size={14} aria-hidden="true" />
            Officials
          </Button>
          <Button href="/admin/offices" variant="outline" size="sm">
            <Building2 size={14} aria-hidden="true" />
            Offices
          </Button>
          <Button href="/admin/categories" variant="outline" size="sm">
            <Tags size={14} aria-hidden="true" />
            Categories
          </Button>
          <Button href="/admin/priority" variant="outline" size="sm">
            <SlidersHorizontal size={14} aria-hidden="true" />
            Priority rules
          </Button>
          <Button href="/admin/routing" variant="outline" size="sm">
            <GitBranch size={14} aria-hidden="true" />
            Routing rules
          </Button>
          <Button href="/admin/settings" variant="outline" size="sm">
            <Settings2 size={14} aria-hidden="true" />
            Settings
          </Button>
          <Button href="/api/v1/admin/reports/concerns" variant="secondary" size="sm">
            <Download size={14} aria-hidden="true" />
            Export cases CSV
          </Button>
          <MaintenanceActions />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total cases" value={totals.total} />
        <StatCard label="Resolved / closed" value={totals.resolved} />
        <StatCard label="Unresolved" value={totals.unresolved} />
        <StatCard
          label="Average processing time"
          value={formatHours(processingTime.averageHours)}
          hint={`${processingTime.sampleSize} resolved case${
            processingTime.sampleSize === 1 ? "" : "s"
          } measured`}
        />
      </div>

      <AlertComposer />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card
          title="Cases by status"
          description="Distribution across the case lifecycle."
        >
          <DonutChart
            centerLabel="Cases"
            segments={byStatus.map((entry) => ({
              label: statusLabel(entry.status),
              value: entry.count,
              color: STATUS_COLORS[entry.status],
            }))}
          />
        </Card>

        <Card
          title="Cases by priority"
          description="Priority level assigned by the assessment engine or an official."
        >
          <BarChart
            items={byPriority.map((entry) => ({
              label: statusLabel(entry.level),
              value: entry.count,
              tone: PRIORITY_TONES[entry.level],
            }))}
          />
        </Card>

        <Card title="Cases by category" description="Submission volume per category.">
          <BarChart
            items={byCategory.map((entry) => ({
              label: entry.name,
              value: entry.count,
              tone: "brand",
            }))}
            emptyLabel="No cases have been submitted yet."
          />
        </Card>

        <Card
          title="Cases by office"
          description="Where cases are currently assigned."
        >
          <BarChart
            items={byOffice.map((entry) => ({
              label: entry.name,
              value: entry.count,
              tone: "violet",
            }))}
            emptyLabel="No cases have been assigned yet."
          />
        </Card>
      </div>

      <Card
        title="Processing time"
        description="Measured only for cases with reliable timestamps (both a submission time and a recorded resolution time)."
      >
        {processingTime.sampleSize === 0 ? (
          <p className="py-6 text-center text-sm text-slate-600">
            No resolved cases with reliable timestamps yet.
          </p>
        ) : (
          <dl className="grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-sm text-slate-500">Average</dt>
              <dd className="mt-1 text-2xl font-bold text-slate-900">
                {formatHours(processingTime.averageHours)}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-slate-500">Fastest</dt>
              <dd className="mt-1 text-2xl font-bold text-slate-900">
                {formatHours(processingTime.fastestHours)}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-slate-500">Slowest</dt>
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
