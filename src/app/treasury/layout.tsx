import { RoleShell } from "@/components/role-shell";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";
import { treasuryNavItems } from "@/lib/portal-nav";

export default async function TreasuryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const t = copy[locale];

  return (
    <RoleShell roles={["TREASURER", "ADMIN"]} items={treasuryNavItems(t)}>
      {children}
    </RoleShell>
  );
}
