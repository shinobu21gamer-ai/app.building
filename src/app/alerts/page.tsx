import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { Container } from "@/components/ui/container";
import { Button } from "@/components/ui/button";
import { requireUser, roleHome } from "@/lib/auth/session";
import { getAlertsForUser } from "@/lib/alerts";
import { AlertArchive } from "@/components/alerts/alert-archive";
import { PushSetup } from "@/components/alerts/push-setup";

export const metadata: Metadata = { title: "Alerts" };

export default async function AlertsPage() {
  const user = await requireUser();
  const alerts = await getAlertsForUser(user.id);

  return (
    <Container className="py-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Community alerts</h1>
          <p className="mt-1 text-sm text-slate-600">Important announcements from BarangayResolve administrators.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <PushSetup />
          <Button href={roleHome(user.role.key)} variant="outline" size="sm">
            <ArrowLeft size={15} aria-hidden="true" />
            Back to dashboard
          </Button>
        </div>
      </div>
      <AlertArchive initialAlerts={alerts} canRemoveAlerts={user.role.key === "ADMIN"} />
    </Container>
  );
}
