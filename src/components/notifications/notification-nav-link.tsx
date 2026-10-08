"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";

const NOTIFICATIONS_CHANGED = "notifications:changed";

type NotificationChangeEvent = CustomEvent<{ unreadCount: number }>;

export function NotificationNavLink({ initialUnread }: { initialUnread: number }) {
  const [unread, setUnread] = useState(initialUnread);
  const pathname = usePathname();

  useEffect(() => {
    const handleChange = (event: Event) => {
      const detail = (event as NotificationChangeEvent).detail;
      if (typeof detail?.unreadCount === "number") {
        setUnread(Math.max(0, detail.unreadCount));
      }
    };

    window.addEventListener(NOTIFICATIONS_CHANGED, handleChange);
    return () => window.removeEventListener(NOTIFICATIONS_CHANGED, handleChange);
  }, []);

  return (
    <Button
      href="/notifications"
      variant={pathname === "/notifications" ? "secondary" : "ghost"}
      size="sm"
      aria-label={
        unread > 0 ? `Notifications, ${unread} unread` : "Notifications"
      }
    >
      <BellRing size={15} aria-hidden="true" />
      Notifications
      {unread > 0 && (
        <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Button>
  );
}
