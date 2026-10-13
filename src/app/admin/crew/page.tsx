import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { Card } from "@/components/ui/card";
import { CrewDesk } from "@/components/admin/crew-desk";
import { PageHeader } from "@/components/ui/page-header";
import { listCrewDesk } from "@/lib/cases/crew";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";

export const metadata: Metadata = {
  title: "Crew roster",
};

export const dynamic = "force-dynamic";

/**
 * The crew roster desk: every account with the Maintenance Crew role, with its
 * trade, rates, availability, caseload and roster state. The page renders the
 * list; `CrewDesk` does the editing against `/api/v1/admin/crew`.
 */
export default async function AdminCrewPage() {
  await requirePermission("crew.roster.manage");
  const locale = await getLocale();
  const t = copy[locale].admin.crew;

  const [crew, offices] = await Promise.all([
    listCrewDesk(db),
    db.office.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true },
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title={t.title} description={t.lead} />

      <Card>
        <CrewDesk crew={crew} offices={offices} locale={locale} />
      </Card>
    </div>
  );
}
