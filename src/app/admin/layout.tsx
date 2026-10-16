import { RoleShell } from "@/components/role-shell";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";
import { adminNavItems } from "@/lib/portal-nav";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const t = copy[locale];

  return (
    <RoleShell roles={["ADMIN"]} items={adminNavItems(t)}>
      {children}
    </RoleShell>
  );
}
