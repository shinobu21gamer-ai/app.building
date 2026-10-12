import { RoleShell } from "@/components/role-shell";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";

export default async function ResidentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const t = copy[locale].resident;
  const revamp = copy[locale].revamp;
  const items = [
    { href: "/resident", label: t.navDashboard },
    { href: "/resident/concerns", label: t.navConcerns },
    { href: "/resident/concerns/new", label: t.navSubmit },
    { href: "/resident/verification", label: revamp.verification.title },
    { href: "/privacy/requests", label: revamp.privacyCenter.title },
    { href: "/notifications", label: t.navNotifications },
  ];

  return (
    <RoleShell roles={["RESIDENT"]} items={items}>
      {children}
    </RoleShell>
  );
}
