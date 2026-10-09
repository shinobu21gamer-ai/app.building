"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CircleQuestionMark,
  LogIn,
  Menu,
  Search,
  UserPlus,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { LogoutButton } from "@/components/auth/logout-button";
import { NotificationNavLink } from "@/components/notifications/notification-nav-link";
import { ActiveNavLink } from "@/components/ui/active-nav-link";
import { LanguageToggle } from "@/components/site/language-toggle";
import { copy, type Locale } from "@/lib/i18n";

export type SiteHeaderUser = {
  firstName: string;
  roleName: string;
  dashboardHref: string;
  unread: number;
};

export function SiteHeader({
  user,
  locale,
}: {
  user: SiteHeaderUser | null;
  locale: Locale;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const t = copy[locale];

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className="no-print border-b border-slate-200 bg-white">
      <Container className="flex min-h-16 items-center justify-between gap-3 py-2">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-700 text-sm font-bold text-white">
            BR
          </span>
          <span className="text-lg font-semibold text-slate-900">
            BarangayResolve
          </span>
        </Link>

        <nav
          className="hidden flex-wrap items-center justify-end gap-2 md:flex"
          aria-label="Main"
        >
          {user ? (
            <SignedInLinks user={user} labels={t.header} />
          ) : (
            <GuestLinks labels={t.header} />
          )}
          <LanguageToggle locale={locale} label={t.language} />
        </nav>

        <div className="flex items-center gap-2 md:hidden">
          <LanguageToggle locale={locale} label={t.language} />
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100"
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpen((current) => !current)}
          >
            {open ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
            <span className="sr-only">{open ? t.closeMenu : t.openMenu}</span>
          </button>
        </div>
      </Container>

      {open ? (
        <div
          id="mobile-nav"
          className="border-t border-slate-200 bg-white md:hidden"
        >
          <Container className="flex flex-col gap-2 py-3" aria-label="Mobile">
            {user ? (
              <>
                <SignedInLinks user={user} labels={t.header} />
                <p className="px-1 text-xs font-medium text-slate-400">
                  {user.roleName}
                </p>
              </>
            ) : (
              <GuestLinks labels={t.header} />
            )}
          </Container>
        </div>
      ) : null}
    </header>
  );
}

function GuestLinks({
  labels,
}: {
  labels: (typeof copy)["en"]["header"];
}) {
  return (
    <>
      <Button href="/track" variant="ghost" size="sm">
        <Search size={15} aria-hidden="true" />
        {labels.track}
      </Button>
      <Button href="/help" variant="ghost" size="sm">
        <CircleQuestionMark size={15} aria-hidden="true" />
        {labels.help}
      </Button>
      <Button href="/login" variant="ghost" size="sm">
        <LogIn size={15} aria-hidden="true" />
        {labels.signIn}
      </Button>
      <Button href="/register" size="sm">
        <UserPlus size={15} aria-hidden="true" />
        {labels.createAccount}
      </Button>
    </>
  );
}

function SignedInLinks({
  user,
  labels,
}: {
  user: SiteHeaderUser;
  labels: (typeof copy)["en"]["header"];
}) {
  return (
    <>
      <ActiveNavLink href={user.dashboardHref} matchPrefix>
        {labels.dashboard}
      </ActiveNavLink>
      <NotificationNavLink
        initialUnread={user.unread}
        label={labels.notifications}
      />
      <ActiveNavLink href="/alerts">{labels.alerts}</ActiveNavLink>
      <ActiveNavLink href="/profile">{user.firstName}</ActiveNavLink>
      <Button href="/help" variant="ghost" size="sm" className="md:hidden">
        <CircleQuestionMark size={15} aria-hidden="true" />
        {labels.help}
      </Button>
      <span className="hidden text-xs font-medium text-slate-400 lg:block">
        {user.roleName}
      </span>
      <LogoutButton variant="ghost" size="sm" />
    </>
  );
}
