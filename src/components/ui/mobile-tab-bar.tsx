"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { LayoutGrid } from "lucide-react";

import { iconFor } from "@/components/ui/nav-icons";
import { Sheet } from "@/components/ui/sheet";
import { activeHrefFor, partitionNav, type NavItem } from "@/lib/nav";
import { cn } from "@/lib/utils";


/**
 * The mobile shell of every role portal: a fixed bottom tab bar with the four
 * most-used destinations of the role, and a sheet holding the rest. Hidden from
 * `md` up, where the sidebar takes over.
 */
export function MobileTabBar({
  items,
  label,
  moreLabel,
  closeLabel,
}: {
  items: NavItem[];
  label: string;
  moreLabel: string;
  closeLabel: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const { tabs, more } = partitionNav(items);
  const active = activeHrefFor(pathname, items);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const columns = tabs.length + (more.length > 0 ? 1 : 0);
  const moreActive = more.some((item) => item.href === active);

  return (
    <>
      <nav
        aria-label={label}
        className="no-print safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 shadow-tabbar backdrop-blur md:hidden"
      >
        <ul
          className="grid"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {tabs.map((item) => {
            const Icon = iconFor(item.href);
            const isActive = item.href === active;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "tap-target flex flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] font-medium",
                    isActive ? "text-brand-700" : "text-ink-subtle"
                  )}
                >
                  <Icon size={20} aria-hidden="true" />
                  <span className="line-clamp-1 text-center leading-tight">
                    {item.label}
                  </span>
                </Link>
              </li>
            );
          })}
          {more.length > 0 ? (
            <li>
              <button
                type="button"
                onClick={() => setOpen(true)}
                aria-expanded={open}
                aria-haspopup="dialog"
                className={cn(
                  "tap-target flex w-full flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] font-medium",
                  moreActive ? "text-brand-700" : "text-ink-subtle"
                )}
              >
                <LayoutGrid size={20} aria-hidden="true" />
                <span className="line-clamp-1 text-center leading-tight">
                  {moreLabel}
                </span>
              </button>
            </li>
          ) : null}
        </ul>
      </nav>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={moreLabel}
        closeLabel={closeLabel}
      >
        <ul className="grid gap-1">
          {more.map((item) => {
            const Icon = iconFor(item.href);
            const isActive = item.href === active;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "tap-target flex items-center gap-3 rounded-control px-3 text-sm font-medium",
                    isActive
                      ? "bg-brand-50 text-brand-800"
                      : "text-ink-muted hover:bg-surface-sunken"
                  )}
                >
                  <Icon size={18} aria-hidden="true" />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </Sheet>
    </>
  );
}
