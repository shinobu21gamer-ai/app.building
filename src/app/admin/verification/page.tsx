import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { VerificationReview } from "@/components/admin/verification-review";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/lib/auth/session";
import { copy } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";

export const metadata: Metadata = {
  title: "ID verification",
  description: "Review the identity documents residents submitted.",
};

export const dynamic = "force-dynamic";

export default async function AdminVerificationPage() {
  await requirePermission("privacy.identity.review");
  const locale = await getLocale();
  const t = copy[locale].revamp.adminDesk;

  return (
    <div className="space-y-6">
      <PageHeader title={t.verificationTitle} description={t.verificationLead} />

      <Card>
        <VerificationReview locale={locale} />
      </Card>
    </div>
  );
}
