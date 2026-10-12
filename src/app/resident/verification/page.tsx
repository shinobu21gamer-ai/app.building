import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { VerificationForm } from "@/components/identity/verification-form";
import { PageHeader } from "@/components/ui/page-header";
import { requireRole } from "@/lib/auth/session";
import { identityGateDecision } from "@/lib/identity/policy";
import {
  identityView,
  isIdentityGateEnabled,
} from "@/lib/identity/verification";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";
import { db } from "@/lib/db";

export const metadata: Metadata = {
  title: "Identity verification",
  description:
    "Submit an identity document so assistance and budget concerns can be processed.",
};

export const dynamic = "force-dynamic";

/** Date fields are serialised for the client form. */
function toClientView(row: Awaited<ReturnType<typeof db.identityVerification.findUnique>>) {
  const view = identityView(row);
  return {
    status: view.status,
    method: view.method,
    idTypeLabel: view.idTypeLabel,
    idNumberLast4: view.idNumberLast4,
    submittedAt: view.submittedAt?.toISOString() ?? null,
    reviewedAt: view.reviewedAt?.toISOString() ?? null,
    decisionReason: view.decisionReason,
    verifiedAt: view.verifiedAt?.toISOString() ?? null,
    hasIdImage: view.hasIdImage,
    canResubmit: view.canResubmit,
  };
}

export default async function ResidentVerificationPage() {
  const user = await requireRole(["RESIDENT"]);
  const locale = await getLocale();
  const t = copy[locale].revamp;

  const [row, gateEnabled] = await Promise.all([
    db.identityVerification.findUnique({ where: { userId: user.id } }),
    isIdentityGateEnabled(),
  ]);

  const view = toClientView(row);
  const gate = identityGateDecision({
    concernTypeKey: "AYUDA",
    status: view.status,
    gateEnabled,
  });

  return (
    <div className="space-y-6">
      <PageHeader title={t.verification.title} description={t.verification.lead} />

      <Card title={t.verification.gateTitle}>
        {!gateEnabled ? (
          <p className="text-sm text-ink-muted">{t.verification.gateOff}</p>
        ) : gate.allowed ? (
          <p className="text-sm text-ink-muted">
            {gate.advisory ? t.verification.gateAdvisory : t.verification.statusLabels.VERIFIED}
          </p>
        ) : (
          <p className="text-sm text-ink-muted">
            {gate.code === "IDENTITY_PENDING"
              ? t.verification.gatePending
              : gate.code === "IDENTITY_REJECTED"
                ? t.verification.gateRejected
                : t.verification.gateRequired}
          </p>
        )}
      </Card>

      <Card>
        <VerificationForm initial={view} locale={locale} />
      </Card>
    </div>
  );
}
