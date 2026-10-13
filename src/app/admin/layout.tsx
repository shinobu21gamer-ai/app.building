import { RoleShell } from "@/components/role-shell";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const t = copy[locale].admin;
  const revamp = copy[locale].revamp.adminDesk;
  const items = [
    { href: "/admin", label: t.navDashboard },
    { href: "/admin/reports", label: t.navReports },
    { href: "/admin/users", label: t.navUsers },
    { href: "/admin/crew", label: t.crew.navCrew },
    { href: "/admin/officials", label: t.navOfficials },
    { href: "/admin/offices", label: t.navOffices },
    { href: "/admin/categories", label: t.navCategories },
    { href: "/admin/routing", label: t.navRouting },
    { href: "/admin/priority", label: t.navPriority },
    { href: "/admin/validation", label: revamp.validationNav },
    { href: "/admin/field-checks", label: t.fieldCheck.navFieldCheck },
    { href: "/admin/verification", label: revamp.verificationNav },
    { href: "/admin/privacy", label: revamp.privacyNav },
    { href: "/admin/roles", label: revamp.rolesNav },
    { href: "/admin/treasury", label: revamp.treasuryNav },
    { href: "/admin/sla", label: revamp.slaNav },
    { href: "/admin/audit", label: revamp.auditNav },
    { href: "/admin/settings", label: t.navSettings },
    { href: "/notifications", label: t.navNotifications },
  ];

  return (
    <RoleShell roles={["ADMIN"]} items={items}>
      {children}
    </RoleShell>
  );
}
