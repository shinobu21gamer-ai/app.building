import type { Metadata } from "next";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { requireRole, roleHome } from "@/lib/auth/session";
import {
  countUnreadNotifications,
  listNotifications,
  notificationView,
} from "@/lib/notifications/query";
import { NotificationInbox } from "@/components/notifications/notification-inbox";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";

export const metadata: Metadata = {
  title: "Notifications",
};

export default async function NotificationsPage() {
  const user = await requireRole(["RESIDENT", "OFFICIAL", "ADMIN"]);
  const locale = await getLocale();
  const t = copy[locale].notifications;

  const [notifications, unreadCount] = await Promise.all([
    listNotifications(user.id, { unread: false, concernId: null, limit: 100 }),
    countUnreadNotifications(user.id),
  ]);

  return (
    <Container className="py-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t.title}</h1>
          <p className="mt-1 text-sm text-slate-600">{t.lead}</p>
        </div>
        <Button href={roleHome(user.role.key)} variant="outline" size="sm">
          {t.back}
        </Button>
      </div>

      <NotificationInbox
        notifications={notifications.map(notificationView)}
        unreadCount={unreadCount}
        role={user.role.key}
        locale={locale}
      />
    </Container>
  );
}
