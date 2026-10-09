"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/field";
import { apiRequest } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { copy, type Locale } from "@/lib/i18n";

export type NotificationItem = {
  id: number;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
  concern: { id: number; caseNumber: string; title: string } | null;
};

type Filter = "all" | "unread";

function caseHref(role: string, concernId: number): string {
  return role === "RESIDENT"
    ? `/resident/concerns/${concernId}`
    : `/official/concerns/${concernId}`;
}

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

  const visible =
    filter === "unread"
      ? items.filter((item) => !item.isRead)
      : items;

  async function markRead(item: NotificationItem) {
    if (item.isRead) return;
    setError(null);
    setSuccess(null);
    setBusy(true);
    const result = await apiRequest<{ notification: NotificationItem }>(
      `/api/v1/notifications/${item.id}`,
      { method: "PATCH", body: JSON.stringify({ isRead: true }) }
    );
    setBusy(false);

    if (!result.success) {
      setError(result.error.message);
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
    router.refresh();
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
        <p className="rounded-xl border border-slate-200 bg-white py-12 text-center text-sm text-slate-600">
          {filter === "unread" ? t.emptyUnread : t.empty}
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {visible.map((item) => {
            const unread = !item.isRead;
            return (
              <li
                key={item.id}
                className={unread ? "bg-brand-50/40 px-4 py-4" : "px-4 py-4"}
              >
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
                      <p className="text-sm font-semibold text-slate-900">
                        {item.title}
                      </p>
                      {unread && <Badge tone="blue">{t.new}</Badge>}
                    </div>
                    <p className="mt-1 text-sm text-slate-600">{item.message}</p>

                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                      <span>{formatDateTime(item.createdAt)}</span>
                      {item.concern && (
                        <Link
                          href={caseHref(role, item.concern.id)}
                          className="font-medium text-brand-700 hover:text-brand-800"
                        >
                          {item.concern.caseNumber} · {item.concern.title}
                        </Link>
                      )}
                    </div>

                    {unread && (
                      <div className="mt-2">
                        <button
                          type="button"
                          onClick={() => markRead(item)}
                          disabled={busy}
                          className="rounded-md px-2 py-1 text-xs font-semibold text-slate-600 transition-[background-color,color] duration-150 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 disabled:opacity-50"
                        >
                          {t.markRead}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
