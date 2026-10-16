"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { apiRequest } from "@/lib/api-client";
import { BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";

const NOTIFICATIONS_CHANGED = "notifications:changed";

type NotificationChangeEvent = CustomEvent<{ unreadCount: number }>;

export function NotificationNavLink({
  initialUnread,
  label = "Notifications",
}: {
  initialUnread: number;
  label?: string;
}) {
  const [unread, setUnread] = useState(initialUnread);
  const lastUnread = useRef(initialUnread);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const handleChange = (event: Event) => {
      const detail = (event as NotificationChangeEvent).detail;
      if (typeof detail?.unreadCount === "number") {
        const next = Math.max(0, detail.unreadCount);
        lastUnread.current = next;
        setUnread(next);
      }
    };

    window.addEventListener(NOTIFICATIONS_CHANGED, handleChange);
    return () => window.removeEventListener(NOTIFICATIONS_CHANGED, handleChange);
  }, []);

  useEffect(() => {
    let active = true;
    async function refreshUnread() {
      const result = await apiRequest<{ unreadCount: number }>(
        "/api/v1/notifications?unread=true&limit=1",
        { cache: "no-store" }
      );
      if (!active || !result.success) return;
      const next = Math.max(0, result.data.unreadCount);
      const changed = next !== lastUnread.current;
      lastUnread.current = next;
      setUnread(next);
      if (changed) {
        window.dispatchEvent(
          new CustomEvent("notifications:changed", { detail: { unreadCount: next } })
        );
        if (pathname === "/notifications") router.refresh();
      }
    }

    const timer = window.setInterval(() => void refreshUnread(), 30_000);
    window.addEventListener("focus", refreshUnread);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshUnread);
    };
  }, [pathname, router]);

  return (
    <Button
      href="/notifications"
      variant={pathname === "/notifications" ? "secondary" : "ghost"}
      size="sm"
      aria-label={
        unread > 0 ? `${label}, ${unread} unread` : label
      }
    >
      <BellRing size={15} aria-hidden="true" />
      {label}
      {unread > 0 && (
        <span className="relative ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white">
          <span
            aria-hidden="true"
            className="absolute inset-0 animate-ping rounded-full bg-red-500/60"
            style={{ animationIterationCount: 3 }}
          />
          <span className="relative">{unread > 99 ? "99+" : unread}</span>
        </span>
      )}
    </Button>
  );
}
