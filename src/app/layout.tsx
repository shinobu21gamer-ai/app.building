import type { Metadata } from "next";
import "./globals.css";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { getAuthUser, roleHome } from "@/lib/auth/session";
import { getLocale } from "@/lib/locale";
import { copy } from "@/lib/i18n";
import { countUnreadNotifications } from "@/lib/notifications/query";
import { AlertListener } from "@/components/alerts/alert-listener";
import { NativePushListener } from "@/components/alerts/native-push-listener";
import { NativeCrashNotice } from "@/components/alerts/native-crash-notice";
import { PushSessionSync } from "@/components/alerts/push-session-sync";
import { ToastProvider } from "@/components/ui/toast";

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
    "Report a community concern to your barangay, get a case number, and track it until it is resolved.",
  applicationName: "BarangayResolve",
  authors: [{ name: "BarangayResolve" }],
  openGraph: {
    title: "BarangayResolve",
    description:
      "The barangay's online window for community concerns — submit, track, and see a recorded resolution.",
    images: [{ url: "/og.image.png" }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "BarangayResolve",
    description:
      "Report a community concern, get a case number, and track it until it is resolved.",
    images: ["/og.image.png"],
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await getAuthUser();
  const unread = user ? await countUnreadNotifications(user.id) : 0;
  const locale = await getLocale();
  const t = copy[locale];

  return (
    <html lang={locale === "fil" ? "fil" : "en"}>
      <body className="antialiased flex min-h-screen flex-col">
        <ToastProvider>
          <AlertListener enabled={Boolean(user)} />
          <NativePushListener />
          <PushSessionSync signedIn={Boolean(user)} />
          <NativeCrashNotice />
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded-lg focus:bg-brand-700 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
          >
            {t.skip}
          </a>
          <SiteHeader
            locale={locale}
            user={
              user
                ? {
                    firstName: user.firstName,
                    roleName: user.role.name,
                    dashboardHref: roleHome(user.role.key),
                    unread,
                  }
                : null
            }
          />

          <main id="main-content" className="flex-1">
            {children}
          </main>

          <SiteFooter locale={locale} />
        </ToastProvider>
      </body>
    </html>
  );
}