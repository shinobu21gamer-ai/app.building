import type { Metadata } from "next";
import Link from "next/link";
import { LogIn, UserPlus } from "lucide-react";
import "./globals.css";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { LogoutButton } from "@/components/auth/logout-button";
import { NotificationNavLink } from "@/components/notifications/notification-nav-link";
import { ActiveNavLink } from "@/components/ui/active-nav-link";
import { getAuthUser, roleHome } from "@/lib/auth/session";
import { countUnreadNotifications } from "@/lib/notifications/query";
import { AlertListener } from "@/components/alerts/alert-listener";
import { NativePushListener } from "@/components/alerts/native-push-listener";
import { NativeCrashNotice } from "@/components/alerts/native-crash-notice";
import { PushSessionSync } from "@/components/alerts/push-session-sync";

function appBaseUrl(): URL {
  const candidate = process.env.NEXT_PUBLIC_APP_URL;
  if (candidate) {
    try {
      return new URL(candidate);
    } catch {
      /* malformed env var: fall back below rather than crash every route */
    }
  }
  return new URL("http://localhost:3000");
}

export const metadata: Metadata = {
  metadataBase: appBaseUrl(),
  title: {
    default: "BarangayResolve",
    template: "%s | BarangayResolve",
  },
  description:
    "A web-based smart community concern prioritization, routing, and resolution management system for barangays.",
  applicationName: "BarangayResolve",
  authors: [{ name: "College Capstone Project" }],
};

async function HeaderNav() {
  const user = await getAuthUser();
  const unread = user ? await countUnreadNotifications(user.id) : 0;

  return (
    <Container className="flex min-h-16 items-center justify-between gap-3 py-2">
      <Link href="/" className="flex shrink-0 items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-700 text-sm font-bold text-white">
          BR
        </span>
        <span className="hidden text-lg font-semibold text-slate-900 sm:block">
          BarangayResolve
        </span>
      </Link>

      <nav className="flex flex-wrap items-center justify-end gap-2">
        {user ? (
          <>
            <ActiveNavLink href={roleHome(user.role.key)} matchPrefix>
              Dashboard
            </ActiveNavLink>
            <NotificationNavLink initialUnread={unread} />
            <ActiveNavLink href="/alerts">Alerts</ActiveNavLink>
            <ActiveNavLink href="/profile">
              {user.firstName}
            </ActiveNavLink>
            <span className="hidden text-xs font-medium text-slate-400 sm:block">
              {user.role.name}
            </span>
            <LogoutButton variant="ghost" size="sm" />
          </>
        ) : (
          <>
            <Button href="/login" variant="ghost" size="sm">
              <LogIn size={15} aria-hidden="true" />
              Sign in
            </Button>
            <Button href="/register" size="sm">
              <UserPlus size={15} aria-hidden="true" />
              Create account
            </Button>
          </>
        )}
      </nav>
    </Container>
  );
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // `getAuthUser` is request-cached, so this shares the lookup done by HeaderNav.
  const user = await getAuthUser();

  return (
    <html lang="en">
      <body className="antialiased flex min-h-screen flex-col">
        <AlertListener enabled={Boolean(user)} />
        <NativePushListener />
        <PushSessionSync signedIn={Boolean(user)} />
        <NativeCrashNotice />
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded-lg focus:bg-brand-700 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
        >
          Skip to content
        </a>
        <header className="border-b border-slate-200 bg-white">
          <HeaderNav />
        </header>

        <main id="main-content" className="flex-1">
          {children}
        </main>

        <footer className="border-t border-slate-200 bg-white">
          <Container className="flex flex-col items-center justify-between gap-2 py-6 text-sm text-slate-500 sm:flex-row">
            <span>BarangayResolve — Smart Community Concern Management</span>
            <span>Barangay Resolve System · Capstone Project</span>
          </Container>
        </footer>
      </body>
    </html>
  );
}