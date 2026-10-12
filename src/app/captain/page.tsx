import { PortalIntro } from "@/components/portals/portal-intro";
import { Container } from "@/components/ui/container";
import {
  getEffectivePermissions,
  requirePermission,
} from "@/lib/auth/session";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";

/**
 * /captain — Barangay Captain portal landing.
 * Disbursement approvals, the 48-hour escalation queue, case closure and
 * barangay-wide reports arrive with the treasury, SLA and reports stages.
 */
export default async function CaptainPage() {
  const user = await requirePermission("sla.escalation.view");
  const permissions = [...(await getEffectivePermissions(user.role.key))].sort();
  const locale = await getLocale();
  const t = copy[locale].revamp;

  return (
    <Container className="py-8">
      <PortalIntro
        title={t.captain.title}
        lead={t.captain.lead}
        permissions={permissions}
        permissionsTitle={t.portal.permissionsTitle}
        permissionsLead={t.portal.permissionsLead}
        modulesTitle={t.portal.upcomingTitle}
        modulesUnavailable={t.common.none}
        modules={t.captain.modules}
      />
    </Container>
  );
}

export const dynamic = "force-dynamic";
