import { RoleShell } from "@/components/role-shell";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";

export default async function CaptainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const t = copy[locale].revamp;

  return (
    <RoleShell
      roles={["CAPTAIN", "ADMIN"]}
      items={[
        { href: "/captain", label: t.captain.title },
        { href: "/captain/approvals", label: t.treasuryDesk.navApprovals },
        { href: "/notifications", label: t.common.notifications },
      ]}
    >
      {children}
    </RoleShell>
  );
}
