import { PortalIntro } from "@/components/portals/portal-intro";
import { Container } from "@/components/ui/container";
import {
  getEffectivePermissions,
  requirePermission,
} from "@/lib/auth/session";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";

/**
 * /treasury — treasurer portal landing.
 * Budget, earmark, voucher and ledger screens arrive with the treasury stage;
 * until then this page shows the role's effective permissions in place, which
 * is also how RBAC is verified on a real deployment.
 */
export default async function TreasuryPage() {
  const user = await requirePermission("treasury.balance.view");
  const permissions = [...(await getEffectivePermissions(user.role.key))].sort();
  const locale = await getLocale();
  const t = copy[locale].revamp;

  return (
    <Container className="py-8">
      <PortalIntro
        title={t.treasury.title}
        lead={t.treasury.lead}
        permissions={permissions}
        permissionsTitle={t.portal.permissionsTitle}
        permissionsLead={t.portal.permissionsLead}
        modulesTitle={t.portal.upcomingTitle}
        modulesUnavailable={t.common.none}
        modules={t.treasury.modules}
      />
    </Container>
  );
}

export const dynamic = "force-dynamic";
