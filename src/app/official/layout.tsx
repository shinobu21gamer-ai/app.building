import { RoleShell } from "@/components/role-shell";
import { requireUser } from "@/lib/auth/session";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";
import {
  adminNavItems,
  captainNavItems,
  officialNavItems,
  treasuryNavItems,
} from "@/lib/portal-nav";

/**
 * The office portal's shell.
 *
 * Officials work every page under `/official`. Administrators, the Captain
 * and the treasurer are admitted to the shared case sheet at
 * `/official/concerns/[id]`. While they sit on it they keep their own desks
 * in the menu, not the office queue that would turn them away.
 */
export default async function OfficialLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const locale = await getLocale();
  const t = copy[locale];
  const role = user.role.key;
  const items =
    role === "CAPTAIN"
      ? captainNavItems(t)
      : role === "TREASURER"
        ? treasuryNavItems(t)
        : role === "ADMIN"
          ? adminNavItems(t)
          : officialNavItems(t);

  return (
    <RoleShell
      roles={["OFFICIAL", "ADMIN", "CAPTAIN", "TREASURER"]}
      items={items}
    >
      {children}
    </RoleShell>
  );
}
