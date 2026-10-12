import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SubmitConcernForm } from "@/components/concern/submit-concern-form";
import { PageHeader } from "@/components/ui/page-header";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";
import { getBarangayAreas } from "@/lib/cases/settings";

export const metadata: Metadata = {
  title: "Submit Concern",
};

export default async function NewConcernPage() {
  await requireRole(["RESIDENT"]);
  const locale = await getLocale();
  const t = copy[locale].submit;

  const [categories, factors, areas, types] = await Promise.all([
    db.concernCategory.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.priorityFactorConfig.findMany({
      where: { isActive: true },
      orderBy: { displayOrder: "asc" },
      select: {
        key: true,
        label: true,
        description: true,
        minScore: true,
        maxScore: true,
      },
    }),
    getBarangayAreas(db),
    db.concernType.findMany({
      where: { isActive: true },
      orderBy: { displayOrder: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title={t.title} description={t.lead} />

      <Card>
        {categories.length === 0 || factors.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm text-ink-muted">{t.unavailable}</p>
            <Button
              href="/resident/concerns"
              variant="outline"
              className="mt-3"
              size="sm"
            >
              {t.back}
            </Button>
          </div>
        ) : (
          <SubmitConcernForm
            categories={categories}
            factors={factors}
            areas={areas}
            types={types}
            locale={locale}
          />
        )}
      </Card>
    </div>
  );
}
