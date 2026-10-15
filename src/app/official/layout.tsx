import { RoleShell } from "@/components/role-shell";
import { requireUser } from "@/lib/auth/session";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";
import {
  captainNavItems,
  officialNavItems,
  treasuryNavItems,
} from "@/lib/portal-nav";

/**
 * The office portal's shell.
 *
 * Officials and administrators work every page under `/official`. The Captain
 * and the treasurer are admitted to one route in this tree — the shared case
 * sheet at `/official/concerns/[id]`. While they sit on it they keep their own
 * desks in the menu, not the office queue that would turn them away.
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
