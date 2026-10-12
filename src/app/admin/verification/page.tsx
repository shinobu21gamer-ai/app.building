import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { VerificationReview } from "@/components/admin/verification-review";
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
      <header>
        <h1 className="text-title text-ink">
          {t.verificationTitle}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
          {t.verificationLead}
        </p>
      </header>

      <Card>
        <VerificationReview locale={locale} />
      </Card>
    </div>
  );
}
