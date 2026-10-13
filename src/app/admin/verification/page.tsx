import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { VerificationReview } from "@/components/admin/verification-review";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/lib/auth/session";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";
import { piiKeyProblemMessage, piiKeyStatus } from "@/lib/privacy/crypto";

export const metadata: Metadata = {
  title: "ID verification",
  description: "Review the identity documents residents submitted.",
};

export const dynamic = "force-dynamic";

export default async function AdminVerificationPage() {
  await requirePermission("privacy.identity.review");
  const locale = await getLocale();
  const t = copy[locale].revamp.adminDesk;

  // An empty queue and "the server refuses every submission" look the same from
  // this desk; the reviewer is the person who can act on it, so say which one
  // it is.
  const keyStatus = piiKeyStatus();

  return (
    <div className="space-y-6">
      <PageHeader title={t.verificationTitle} description={t.verificationLead} />

      {!keyStatus.ready && (
        <Card title={t.keyMissingTitle}>
          <p className="text-sm leading-relaxed text-ink-muted">
            {t.keyMissingBody}
          </p>
          <p className="mt-3 rounded-control border border-warning-100 bg-warning-50 px-3 py-2 text-xs leading-relaxed text-warning-700">
            {piiKeyProblemMessage(keyStatus)}
          </p>
        </Card>
      )}

      <Card>
        <VerificationReview locale={locale} />
      </Card>
    </div>
  );
}
