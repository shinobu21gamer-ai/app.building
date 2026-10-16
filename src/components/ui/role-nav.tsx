"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { iconFor } from "@/components/ui/nav-icons";
import { activeHrefFor, type NavItem } from "@/lib/nav";
import { cn } from "@/lib/utils";

export type RoleNavItem = NavItem;

/**
 * The desktop half of the role shell: a list of the role's destinations beside
 * the content, pinned under the header while the page scrolls. Below `md` this
 * disappears and `<MobileTabBar/>` takes over, which is why the layout reads as
 * a phone app first and a desktop app second.
 *
 * The list scrolls on its own. A role with a long menu (the admin desk has
 * seventeen destinations) is taller than the viewport, and a bare `sticky` list
 * made everything past the fold unreachable — the sticky box cannot move, so
 * there is no page scroll left to reveal the tail. Sticking the *scroller*
 * instead keeps the menu pinned beside the content while every item stays
 * reachable.
 */
export function RoleNav({
  items,
  label,
}: {
  items: RoleNavItem[];
  label: string;
}) {
  const pathname = usePathname();
  const activeHref = activeHrefFor(pathname, items);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLAnchorElement>(null);

  // Open the menu on the destination the reader is already looking at: with
  // more items than fit, the active row can start below the fold. This moves the
  // menu's own scroll position only — `scrollIntoView` would drag the page along
  // with it and drop the reader into the middle of the dashboard.
  useEffect(() => {
    const scroller = scrollerRef.current;
    const item = activeRef.current;
    if (!scroller || !item) return;

    const itemTop = item.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top + scroller.scrollTop;
    const itemBottom = itemTop + item.offsetHeight;
    const viewTop = scroller.scrollTop;
    const viewBottom = viewTop + scroller.clientHeight;

    if (itemTop < viewTop || itemBottom > viewBottom) {
      scroller.scrollTop = Math.max(itemTop - 8, 0);
    }
  }, [activeHref]);

  return (
    <nav
      aria-label={label}
      className="no-print sticky top-20 hidden self-start min-h-0 md:block md:w-60 md:shrink-0 2xl:w-72"
    >
      <div
        ref={scrollerRef}
        tabIndex={0}
        role="region"
        aria-label={label}
        className="nav-scroll relative h-[calc(100dvh-6rem)] min-h-0 overflow-y-auto overscroll-contain rounded-xl border border-line bg-surface/60 p-2 focus-visible:outline-2 focus-visible:outline-brand-600"
      >
        <ul className="grid gap-0.5">
          {items.map((item, index) => {
            const Icon = iconFor(item.href);
            const active = item.href === activeHref;
            const showSection =
              Boolean(item.section) && item.section !== items[index - 1]?.section;
            return (
              <li key={item.href}>
                {showSection ? (
                  <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle first:pt-1">
                    {item.section}
                  </p>
                ) : null}
                <Link
                  ref={active ? activeRef : undefined}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2.5 rounded-control px-3 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-brand-600",
                    active
                      ? "bg-brand-50 font-semibold text-brand-800 ring-1 ring-brand-100"
                      : "font-medium text-ink-muted hover:bg-surface-sunken hover:text-ink"
                  )}
                >
                  <Icon
                    size={17}
                    aria-hidden="true"
                    className={active ? "text-brand-700" : "text-ink-subtle"}
                  />
                  <span className="line-clamp-1">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
