import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { requireUser, roleHome } from "@/lib/auth/session";
import { getAlertsForUser } from "@/lib/alerts";
import { AlertArchive } from "@/components/alerts/alert-archive";
import { NativeDiagnosticsCard } from "@/components/alerts/native-diagnostics-card";
import { PushSetup } from "@/components/alerts/push-setup";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";

export const metadata: Metadata = { title: "Alerts" };

export default async function AlertsPage() {
  const user = await requireUser();
  const locale = await getLocale();
  const t = copy[locale].alerts;
  const alerts = await getAlertsForUser(user.id);

  return (
    <Container className="py-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t.title}</h1>
          <p className="mt-1 text-sm text-slate-600">{t.lead}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <PushSetup />
          <Button href={roleHome(user.role.key)} variant="outline" size="sm">
            <ArrowLeft size={15} aria-hidden="true" />
            {t.back}
          </Button>
        </div>
      </div>
      <NativeDiagnosticsCard />
      <AlertArchive
        initialAlerts={alerts}
        canRemoveAlerts={user.role.key === "ADMIN"}
        locale={locale}
      />
    </Container>
  );
}
