import { RoleShell } from "@/components/role-shell";
import { requireUser } from "@/lib/auth/session";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";
import { captainNavItems, officialNavItems } from "@/lib/portal-nav";

/**
 * The office portal's shell.
 *
 * Officials and administrators work every page under `/official`. The Captain
 * is admitted to one route in this tree — the shared case sheet at
 * `/official/concerns/[id]`, where they read the proof of completion, verify it
 * and close the case (see `SHARED_PORTAL_ROUTES` in `@/lib/auth/roles`); every
 * other page here guards itself and sends them back to their own portal.
 *
 * The shell is what all of those pages render, so the visitor decides the menu:
 * a Captain sitting on a case sheet gets the Captain's desks, not a queue,
 * dashboard and printouts that would each turn them away.
 */
export default async function OfficialLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const locale = await getLocale();
  const t = copy[locale];
  const isCaptain = user.role.key === "CAPTAIN";

  return (
    <RoleShell
      roles={["OFFICIAL", "ADMIN", "CAPTAIN"]}
      items={isCaptain ? captainNavItems(t) : officialNavItems(t)}
    >
      {children}
    </RoleShell>
  );
}
