"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { iconFor } from "@/components/ui/nav-icons";
import { activeHrefFor, type NavItem } from "@/lib/nav";
import { cn } from "@/lib/utils";

export type RoleNavItem = NavItem;

/**
 * The desktop half of the role shell: a sticky vertical list of the role's
 * destinations beside the content. Below `md` this disappears and
 * `<MobileTabBar/>` takes over, which is why the layout reads as a phone app
 * first and a desktop app second.
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

  return (
    <nav
      aria-label={label}
      className="no-print hidden md:block md:w-60 md:shrink-0 2xl:w-72"
    >
      <ul className="sticky top-20 grid gap-0.5">
        {items.map((item) => {
          const Icon = iconFor(item.href);
          const active = item.href === activeHref;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-control px-3 py-2 text-sm transition-colors",
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
    </nav>
  );
}
