import { PortalIntro } from "@/components/portals/portal-intro";
import { Container } from "@/components/ui/container";
import {
  getEffectivePermissions,
  requirePermission,
} from "@/lib/auth/session";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";

/**
 * /crew — maintenance crew portal landing.
 * Today's jobs, progress updates and the crew schedule arrive with the core
 * workflow (manpower and crew assignment) stage.
 */
export default async function CrewPage() {
  const user = await requirePermission("crew.job.view.own");
  const permissions = [...(await getEffectivePermissions(user.role.key))].sort();
  const locale = await getLocale();
  const t = copy[locale].revamp;

  return (
    <Container className="py-8">
      <PortalIntro
        title={t.crew.title}
        lead={t.crew.lead}
        permissions={permissions}
        permissionsTitle={t.portal.permissionsTitle}
        permissionsLead={t.portal.permissionsLead}
        modulesTitle={t.portal.upcomingTitle}
        modulesUnavailable={t.common.none}
        modules={t.crew.modules}
      />
    </Container>
  );
}

export const dynamic = "force-dynamic";
