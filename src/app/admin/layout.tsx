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
  const items = [
    { href: "/admin", label: t.navDashboard },
    { href: "/admin/reports", label: t.navReports },
    { href: "/admin/users", label: t.navUsers },
    { href: "/admin/officials", label: t.navOfficials },
    { href: "/admin/offices", label: t.navOffices },
    { href: "/admin/categories", label: t.navCategories },
    { href: "/admin/routing", label: t.navRouting },
    { href: "/admin/priority", label: t.navPriority },
    { href: "/admin/settings", label: t.navSettings },
    { href: "/notifications", label: t.navNotifications },
  ];

  return (
    <RoleShell roles={["ADMIN"]} items={items}>
      {children}
    </RoleShell>
  );
}
