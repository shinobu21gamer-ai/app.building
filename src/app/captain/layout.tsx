import { RoleShell } from "@/components/role-shell";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";
import { captainNavItems } from "@/lib/portal-nav";

export default async function CaptainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const t = copy[locale];

  return (
    <RoleShell roles={["CAPTAIN", "ADMIN"]} items={captainNavItems(t)}>
      {children}
    </RoleShell>
  );
}
