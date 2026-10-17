"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/field";
import { apiRequest } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { copy, type Locale } from "@/lib/i18n";
import { notificationHref } from "@/lib/notifications/href";

export type NotificationItem = {
  id: number;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
  concern: { id: number; caseNumber: string; title: string } | null;
  loginSecurityReportId?: number | null;
};

type Filter = "all" | "unread";

/**
 * Notifications inbox. Every row is produced by a real domain event on the
 * server; this component only lists them and records read state.
 */
export function NotificationInbox({
  notifications,
  unreadCount,
  role,
  locale = "en",
}: {
  notifications: NotificationItem[];
  unreadCount: number;
  role: string;
  locale?: Locale;
}) {
  const t = copy[locale].notifications;
  const router = useRouter();
  const [items, setItems] = useState(notifications);
  const [remainingUnread, setRemainingUnread] = useState(unreadCount);
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [securityNotice, setSecurityNotice] = useState<string | null>(null);
  const [securityBusy, setSecurityBusy] = useState(false);

  useEffect(() => {
    setItems(notifications);
    setRemainingUnread(unreadCount);
  }, [notifications, unreadCount]);

  const visible =
    filter === "unread"
      ? items.filter((item) => !item.isRead)
      : items;

  async function markRead(item: NotificationItem, options?: { refresh?: boolean }) {
    if (item.isRead) return;
    const refresh = options?.refresh !== false;
    if (refresh) {
      setError(null);
      setSuccess(null);
      setBusy(true);
    }
    const result = await apiRequest<{ notification: NotificationItem }>(
      `/api/v1/notifications/${item.id}`,
      { method: "PATCH", body: JSON.stringify({ isRead: true }) }
    );
    if (refresh) setBusy(false);

    if (!result.success) {
      if (refresh) setError(result.error.message);
      return;
    }
    setItems((current) =>
      current.map((entry) =>
        entry.id === item.id
          ? { ...entry, isRead: true, readAt: new Date().toISOString() }
          : entry
      )
    );
    const nextUnreadCount = Math.max(0, remainingUnread - 1);
    setRemainingUnread(nextUnreadCount);
    window.dispatchEvent(
      new CustomEvent("notifications:changed", {
        detail: { unreadCount: nextUnreadCount },
      })
    );
    if (refresh) router.refresh();
  }

  async function reportLoginAlert(item: NotificationItem) {
    setError(null);
    setSuccess(null);
    setSecurityNotice(null);
    setSecurityBusy(true);
    const result = await apiRequest<{ reported: boolean }>(
      `/api/v1/auth/login-alerts/${item.id}`,
      {
        method: "POST",
        body: JSON.stringify({ report: true }),
      }
    );
    setSecurityBusy(false);
    if (!result.success) {
      setError(result.error.message);
      return;
    }

    setItems((current) =>
      current.map((entry) =>
        entry.id === item.id
          ? {
              ...entry,
              title: t.loginAlertReportedTitle,
              message: t.loginAlertReported,
              isRead: true,
              readAt: new Date().toISOString(),
            }
          : entry
      )
    );
    if (!item.isRead) {
      const nextUnreadCount = Math.max(0, remainingUnread - 1);
      setRemainingUnread(nextUnreadCount);
      window.dispatchEvent(
        new CustomEvent("notifications:changed", {
          detail: { unreadCount: nextUnreadCount },
        })
      );
    }
    setSecurityNotice(t.loginAlertReported);
  }

  async function markAllRead() {
    setError(null);
    setSuccess(null);
    setBusy(true);
    const result = await apiRequest<{ updated: number; unreadCount: number }>(
      "/api/v1/notifications/read-all",
      { method: "POST" }
    );
    setBusy(false);

    if (!result.success) {
      setError(result.error.message);
      return;
    }
    setSuccess(
      result.data.updated > 0
        ? `Marked ${result.data.updated} notification${
            result.data.updated === 1 ? "" : "s"
          } as read.`
        : "You have no unread notifications."
    );
    setItems((current) =>
      current.map((item) =>
        item.isRead
          ? item
          : { ...item, isRead: true, readAt: new Date().toISOString() }
      )
    );
    setRemainingUnread(0);
    window.dispatchEvent(
      new CustomEvent("notifications:changed", {
        detail: { unreadCount: 0 },
      })
    );
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {success && <FormMessage tone="success">{success}</FormMessage>}
      {error && <FormMessage tone="error">{error}</FormMessage>}
      {securityNotice && (
        <div role="status" className="space-y-2 rounded-control border border-brand-200 bg-brand-50 p-3 text-sm text-brand-900">
          <p>{securityNotice}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant={filter === "all" ? "secondary" : "ghost"}
            onClick={() => setFilter("all")}
          >
            {t.all} ({items.length})
          </Button>
          <Button
            type="button"
            size="sm"
            variant={filter === "unread" ? "secondary" : "ghost"}
            onClick={() => setFilter("unread")}
          >
            {t.unread} ({remainingUnread})
          </Button>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={markAllRead}
          disabled={busy || remainingUnread === 0}
        >
          {t.markAll}
        </Button>
      </div>

      {visible.length === 0 ? (
        <p className="rounded-card border border-line bg-surface py-12 text-center text-sm text-ink-muted">
          {filter === "unread" ? t.emptyUnread : t.empty}
        </p>
      ) : (
        <ul className="divide-y divide-line rounded-card border border-line bg-surface">
          {visible.map((item) => {
            const unread = !item.isRead;
            const pendingLoginAlert =
              item.type === "LOGIN_SECURITY_ALERT" &&
              item.title === "Was this sign-in you?";
            const href = notificationHref({
              type: item.type,
              role,
              concernId: item.concern?.id ?? null,
              loginSecurityReportId: item.loginSecurityReportId ?? null,
            });
            const rowClass = unread
              ? "block bg-brand-50/40 px-4 py-4"
              : "block px-4 py-4";
            const row = (
              <div className="flex items-start gap-3">
                <span
                  className={
                    unread
                      ? "mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-brand-600"
                      : "mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-slate-200"
                  }
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-ink">
                      {item.title}
                    </p>
                    {unread && <Badge tone="blue">{t.new}</Badge>}
                  </div>
                  <p className="mt-1 text-sm text-ink-muted">{item.message}</p>

                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-subtle">
                    <span>{formatDateTime(item.createdAt)}</span>
                    {item.concern && (
                      <span className="font-medium text-brand-700">
                        {item.concern.caseNumber} · {item.concern.title}
                      </span>
                    )}
                    {href && (
                      <span className="inline-flex items-center rounded-md border border-brand-200 bg-white px-2.5 py-1 font-semibold text-brand-700 shadow-sm transition-colors hover:border-brand-300 hover:bg-brand-50">
                        {t.open}
                      </span>
                    )}
                  </div>

                  {unread && (
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          void markRead(item);
                        }}
                        disabled={busy}
                        className="rounded-md px-2 py-1 text-xs font-semibold text-ink-muted transition-[background-color,color] duration-150 hover:bg-surface-sunken hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 disabled:opacity-50"
                      >
                        {t.markRead}
                      </button>
                    </div>
                  )}
                  {pendingLoginAlert && (
                    <div className="mt-3">
                      <button
                        type="button"
                        onClick={() => void reportLoginAlert(item)}
                        disabled={securityBusy}
                        className="rounded-md border border-danger-100 bg-white px-3 py-2 text-xs font-semibold text-danger-700 hover:bg-danger-50 disabled:opacity-50"
                      >
                        {t.loginAlertReport}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
            return (
              <li key={item.id}>
                {href ? (
                  <Link
                    href={href}
                    onClick={() => {
                      if (!item.isRead) void markRead(item, { refresh: false });
                    }}
                    className={`${rowClass} hover:bg-surface-sunken/60`}
                  >
                    {row}
                  </Link>
                ) : (
                  <div className={rowClass}>{row}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
