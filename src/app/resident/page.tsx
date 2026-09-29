import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { LogoutButton } from "@/components/auth/logout-button";
import { StatCard } from "@/components/dashboard/stat-card";
import { getResidentDashboard } from "@/lib/dashboards/resident";
import { formatDate, formatDateTime } from "@/lib/format";

export const metadata: Metadata = {
  title: "Resident Dashboard",
};

export default async function ResidentPage() {
  const user = await requireRole(["RESIDENT"]);
  const dashboard = await getResidentDashboard(user.id);
  const { totals, recent, notifications, unreadNotifications } = dashboard;

  const stats = [
    { label: "Total concerns", value: totals.total },
    { label: "Active concerns", value: totals.active },
    { label: "Resolved concerns", value: totals.resolved },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Welcome, {user.firstName}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Submit community concerns and track their progress.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button href="/resident/concerns/new" size="sm">
            Submit concern
          </Button>
          <Button href="/profile" variant="outline" size="sm">
            My profile
          </Button>
          <LogoutButton size="sm" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {stats.map((stat) => (
          <StatCard key={stat.label} label={stat.label} value={stat.value} />
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card
          title="Recent concerns"
          description="Your five most recent submissions."
        >
          {recent.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-sm text-slate-600">
                You have not submitted any concerns yet.
              </p>
              <Button href="/resident/concerns/new" className="mt-3" size="sm">
                Submit your first concern
              </Button>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {recent.map((concern) => (
                <li key={concern.id}>
                  <Link
                    href={`/resident/concerns/${concern.id}`}
                    className="flex flex-wrap items-center justify-between gap-2 py-3 hover:bg-slate-50"
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-900">
                        {concern.title}
                      </p>
                      <p className="text-xs text-slate-500">
                        {concern.caseNumber} · {concern.category.name} ·{" "}
                        {formatDate(concern.createdAt)}
                      </p>
                    </div>
                    <StatusBadge status={concern.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 border-t border-slate-100 pt-4">
            <Button href="/resident/concerns" variant="outline" size="sm">
              View all my concerns
            </Button>
          </div>
        </Card>

        <Card
          title="Notifications"
          description="Your five most recent updates."
        >
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm text-slate-500">Unread</span>
            {unreadNotifications > 0 ? (
              <Badge tone="red">{unreadNotifications} unread</Badge>
            ) : (
              <Badge tone="green">All read</Badge>
            )}
          </div>
          {notifications.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-600">
              No notifications yet. Updates about your concerns will appear here.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {notifications.map((notification) => {
                const body = (
                  <div className="flex items-start gap-2">
                    <span
                      className={
                        notification.isRead
                          ? "mt-1.5 h-2 w-2 shrink-0 rounded-full bg-slate-200"
                          : "mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-600"
                      }
                      aria-hidden
                    />
                    <div>
                      <p className="text-sm font-medium text-slate-900">
                        {notification.title}
                      </p>
                      <p className="text-xs text-slate-600">
                        {notification.message}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {formatDateTime(notification.createdAt)}
                      </p>
                    </div>
                  </div>
                );

                return (
                  <li key={notification.id}>
                    {notification.concernId ? (
                      <Link
                        href={`/resident/concerns/${notification.concernId}`}
                        className="block py-3 hover:bg-slate-50"
                      >
                        {body}
                      </Link>
                    ) : (
                      <div className="py-3">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-4 border-t border-slate-100 pt-4">
            <Button href="/notifications" variant="outline" size="sm">
              View all notifications
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
