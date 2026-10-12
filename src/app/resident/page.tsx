import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { StatCard } from "@/components/dashboard/stat-card";
import { getResidentDashboard } from "@/lib/dashboards/resident";
import { formatDate, formatDateTime } from "@/lib/format";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";

export const metadata: Metadata = {
  title: "Resident Dashboard",
};

export default async function ResidentPage() {
  const user = await requireRole(["RESIDENT"]);
  const locale = await getLocale();
  const t = copy[locale].resident;
  const dashboard = await getResidentDashboard(user.id);
  const { totals, recent, notifications, unreadNotifications } = dashboard;

  const stats = [
    { label: t.total, value: totals.total },
    { label: t.active, value: totals.active },
    { label: t.resolved, value: totals.resolved },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title={t.welcome.replace("{name}", user.firstName)}
        description={t.lead}
        actions={
          <>
            <Button href="/resident/concerns/new" size="sm">
              {t.submit}
            </Button>
            <Button href="/profile" variant="outline" size="sm">
              {t.profile}
            </Button>
          </>
        }
      />

      <div className="stagger grid gap-4 sm:grid-cols-3">
        {stats.map((stat) => (
          <StatCard key={stat.label} label={stat.label} value={stat.value} />
        ))}
      </div>

      <div className="stagger grid gap-6 lg:grid-cols-2">
        <Card title={t.recent} description={t.recentDesc}>
          {recent.length === 0 ? (
            <EmptyState
              title={t.empty}
              action={
                <Button href="/resident/concerns/new" size="sm">
                  {t.first}
                </Button>
              }
            />
          ) : (
            <ul className="divide-y divide-line">
              {recent.map((concern) => (
                <li key={concern.id}>
                  <Link
                    href={`/resident/concerns/${concern.id}`}
                    className="flex flex-wrap items-center justify-between gap-2 py-3 hover:bg-surface-muted"
                  >
                    <div>
                      <p className="text-sm font-medium text-ink">
                        {concern.title}
                      </p>
                      <p className="text-xs text-ink-subtle">
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
          <div className="mt-4 border-t border-line pt-4">
            <Button href="/resident/concerns" variant="outline" size="sm">
              {t.viewAll}
            </Button>
          </div>
        </Card>

        <Card title={t.notifications} description={t.notificationsDesc}>
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm text-ink-subtle">{t.unread}</span>
            {unreadNotifications > 0 ? (
              <Badge tone="red">
                {unreadNotifications} {t.unread.toLowerCase()}
              </Badge>
            ) : (
              <Badge tone="green">{t.allRead}</Badge>
            )}
          </div>
          {notifications.length === 0 ? (
            <EmptyState title={t.noNotes} />
          ) : (
            <ul className="divide-y divide-line">
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
                      <p className="text-sm font-medium text-ink">
                        {notification.title}
                      </p>
                      <p className="text-xs text-ink-muted">
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
                        className="block py-3 hover:bg-surface-muted"
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
          <div className="mt-4 border-t border-line pt-4">
            <Button href="/notifications" variant="outline" size="sm">
              {t.viewNotes}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
