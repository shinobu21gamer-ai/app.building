import { RoleShell } from "@/components/role-shell";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";

export default async function OfficialLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const t = copy[locale].official;
  const items = [
    { href: "/official", label: t.navDashboard },
    { href: "/official/concerns", label: t.navConcerns },
    { href: "/notifications", label: t.navNotifications },
  ];

  return (
    <RoleShell roles={["OFFICIAL", "ADMIN"]} items={items}>
      {children}
    </RoleShell>
  );
}
