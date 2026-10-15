import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ReportingGuide } from "@/components/concern/reporting-guide";
import { SubmitConcernForm } from "@/components/concern/submit-concern-form";
import { ConsentGate } from "@/components/privacy/consent-gate";
import { PageHeader } from "@/components/ui/page-header";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";
import { getBarangayAreas } from "@/lib/cases/settings";
import {
  CONSENT_PURPOSE_LABELS,
  type ConsentPurpose,
} from "@/lib/privacy/catalog";
import { hasConsent } from "@/lib/privacy/consent";
import { needsVerifiedIdentity } from "@/lib/identity/policy";
import {
  getIdentityState,
  isIdentityGateEnabled,
} from "@/lib/identity/verification";

export const metadata: Metadata = {
  title: "Submit Concern",
};

const SUBMIT_CONSENT: ConsentPurpose = "DATA_PROCESSING";

export default async function NewConcernPage() {
  const user = await requireRole(["RESIDENT"]);
  const locale = await getLocale();
  const t = copy[locale].submit;

  // Filing a concern processes the resident's details, so the API refuses
  // without DATA_PROCESSING consent. Checked here as well: the form is
  // replaced by the consent statement, so nobody writes a description,
  // attaches a photo and only then learns that a page they never saw is
  // blocking them.
  const consentGranted = await hasConsent(user.id, SUBMIT_CONSENT);

  if (!consentGranted) {
    const privacy = copy[locale].revamp.privacyCenter;
    const definition = CONSENT_PURPOSE_LABELS[SUBMIT_CONSENT];
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <PageHeader title={t.title} description={t.lead} />
        <Card
          title={privacy.consentRequiredTitle}
          description={privacy.consentRequiredBody}
        >
          <ConsentGate
            purpose={SUBMIT_CONSENT}
            label={definition.label}
            description={definition.description}
            requiredAtSignup={definition.requiredAtSignup}
            locale={locale}
          />
          <div className="mt-4 border-t border-line pt-4">
            <Button href="/privacy/requests" variant="outline" size="sm">
              {privacy.title}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const [categories, factors, areas, types, identity, gateEnabled] =
    await Promise.all([
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
    getIdentityState(user.id),
    isIdentityGateEnabled(),
  ]);
  const identityGate = gateEnabled
    ? {
        verified: identity.isVerified,
        status: identity.status,
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
      <Button href="/resident/concerns" variant="outline" size="sm">{copy[locale].reportingExperience.checkExisting}</Button>
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
            userId={user.id}
            categories={categories}
            factors={factors}
            areas={areas}
            types={types}
            locale={locale}
            identityGate={identityGate}
          />
        )}
      </Card>
    </div>
  );
}
