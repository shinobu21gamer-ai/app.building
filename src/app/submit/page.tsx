import type { Metadata } from "next";
import { db } from "@/lib/db";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ReportingGuide } from "@/components/concern/reporting-guide";
import { SubmitConcernForm } from "@/components/concern/submit-concern-form";
import { PageHeader } from "@/components/ui/page-header";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";
import { getBarangayAreas } from "@/lib/cases/settings";
import { needsVerifiedIdentity } from "@/lib/identity/policy";
import { isIdentityGateEnabled } from "@/lib/identity/verification";

export const metadata: Metadata = {
  title: "Submit a concern anonymously",
};

export const dynamic = "force-dynamic";

export default async function AnonymousSubmitPage() {
  const locale = await getLocale();
  const t = copy[locale].submit;

  const [categories, factors, areas, types, gateEnabled] = await Promise.all([
    db.concernCategory.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        type: { select: { key: true } },
      },
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
      select: { id: true, name: true, key: true },
    }),
    isIdentityGateEnabled(),
  ]);
  const identityGate = gateEnabled
    ? {
        verified: false,
        status: "UNVERIFIED",
        benefitTypeIds: types
          .filter((type) => needsVerifiedIdentity(type.key))
          .map((type) => type.id),
        benefitCategoryIds: categories
          .filter((category) => needsVerifiedIdentity(category.type?.key))
          .map((category) => category.id),
      }
    : undefined;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title={t.title} description={t.lead} />

      <ReportingGuide locale={locale} />
      <Button href="/track" variant="outline" size="sm">
        {copy[locale].reportingExperience.checkExisting}
      </Button>
      <Card>
        {categories.length === 0 || factors.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm text-ink-muted">{t.unavailable}</p>
            <Button href="/" variant="outline" className="mt-3" size="sm">
              {t.back}
            </Button>
          </div>
        ) : (
          <SubmitConcernForm
            userId={0}
            categories={categories}
            factors={factors}
            areas={areas}
            types={types}
            locale={locale}
            anonymous
            identityGate={identityGate}
          />
        )}
      </Card>
    </div>
  );
}
