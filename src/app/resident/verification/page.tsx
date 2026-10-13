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
import { piiKeyProblemMessage, piiKeyStatus } from "@/lib/privacy/crypto";
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

  // Without an encryption key the API refuses every submission (it never
  // stores an ID number in the clear), so the form is not shown at all: the
  // resident is told the feature is not ready on this server instead of
  // filling in a form that can only fail.
  const keyStatus = piiKeyStatus();

  // The stored state is read either way: a resident who was already verified
  // must still be able to see that, even while new submissions are paused.
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

      {keyStatus.ready && (
        <Card title={t.verification.gateTitle}>
          {!gateEnabled ? (
            <p className="text-sm text-ink-muted">{t.verification.gateOff}</p>
          ) : gate.allowed ? (
            <p className="text-sm text-ink-muted">
              {gate.advisory
                ? t.verification.gateAdvisory
                : t.verification.statusLabels.VERIFIED}
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
      )}

      {keyStatus.ready ? (
        <Card>
          <VerificationForm initial={view} locale={locale} />
        </Card>
      ) : (
        <Card title={t.verification.unavailableTitle}>
          {view.status !== "UNVERIFIED" && (
            <p className="text-sm text-ink">
              {t.verification.statusTitle}:{" "}
              <span className="font-semibold">
                {t.verification.statusLabels[view.status]}
              </span>
            </p>
          )}
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            {t.verification.unavailableBody}
          </p>
          {/* Shown to whoever is looking at the screen when something is wrong
              with the deployment: it names the variable, never its value. */}
          <p className="mt-3 rounded-control border border-warning-100 bg-warning-50 px-3 py-2 text-xs leading-relaxed text-warning-700">
            {t.verification.unavailableOperator} {piiKeyProblemMessage(keyStatus)}
          </p>
        </Card>
      )}
    </div>
  );
}
