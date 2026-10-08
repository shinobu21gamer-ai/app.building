"use client";

import { usePathname } from "next/navigation";
import { Bell, LayoutDashboard, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ActiveNavLink({
  href,
  children,
  matchPrefix = false,
}: {
  href: string;
  children: React.ReactNode;
  matchPrefix?: boolean;
}) {
  const pathname = usePathname();
  const active = matchPrefix
    ? pathname === href || pathname.startsWith(`${href}/`)
    : pathname === href;
  const Icon = href === "/alerts"
    ? Bell
    : href === "/profile"
      ? UserRound
      : matchPrefix
        ? LayoutDashboard
        : null;

  return (
    <Button href={href} variant={active ? "secondary" : "ghost"} size="sm">
      {Icon && <Icon size={15} aria-hidden="true" />}
      {children}
    </Button>
  );
}