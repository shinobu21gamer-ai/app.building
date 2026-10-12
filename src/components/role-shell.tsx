import { Container } from "@/components/ui/container";
import { MobileTabBar } from "@/components/ui/mobile-tab-bar";
import { RoleNav, type RoleNavItem } from "@/components/ui/role-nav";
import { requireRole } from "@/lib/auth/session";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";

/**
 * Shared shell for the six role areas (resident / official / admin / treasury /
 * captain / crew): it guards the route tree with the allowed roles and renders
 * the mobile-first frame around the page.
 *
 * Layout: one column on phones with a fixed bottom tab bar (`MobileTabBar`,
 * primary destinations + a "More" sheet), two columns from `md` up with the
 * sticky sidebar (`RoleNav`). Each portal layout only declares its own items
 * and allowed roles; `items` order decides which tabs a role gets on a phone,
 * so the most-used destination is listed first.
 */
export async function RoleShell({
  roles,
  items,
  children,
}: {
  roles: string[];
  items: RoleNavItem[];
  children: React.ReactNode;
}) {
  await requireRole(roles);
  const locale = await getLocale();
  const revamp = copy[locale].revamp.common;

  return (
    <div className="has-tabbar">
      <Container className="py-6 print:py-0 md:py-8">
        <div className="flex gap-8">
          <RoleNav items={items} label={revamp.sectionLabel} />
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </Container>

      <MobileTabBar
        items={items}
        label={revamp.sectionLabel}
        moreLabel={revamp.more}
        closeLabel={revamp.close}
      />
    </div>
  );
}
