"use client";

import { usePathname } from "next/navigation";
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

  return (
    <Button href={href} variant={active ? "secondary" : "ghost"} size="sm">
      {children}
    </Button>
  );
}