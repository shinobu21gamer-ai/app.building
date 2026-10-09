"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export type RoleNavItem = { href: string; label: string };

export function RoleNav({ items }: { items: RoleNavItem[] }) {
  const pathname = usePathname();

  const matches = items.filter(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`)
  );
  const activeHref = matches
    .slice()
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <nav
      aria-label="Section"
      className="no-print mb-6 flex flex-wrap gap-1 border-b border-slate-200 pb-3"
    >
      {items.map((item) => {
        const active = item.href === activeHref;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-medium transition-[background-color,color,box-shadow] duration-150",
              active
                ? "bg-brand-100 text-brand-900 shadow-sm ring-1 ring-brand-200"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
