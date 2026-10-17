"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/field";
import { apiRequest } from "@/lib/api-client";
import { copy, type Locale } from "@/lib/i18n";

export function SecurityReportReview({
  reportId,
  reviewed,
  locale = "en",
}: {
  reportId: number;
  reviewed: boolean;
  locale?: Locale;
}) {
  const t = copy[locale].admin;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function markReviewed() {
    setBusy(true);
    setError(null);
    const result = await apiRequest(`/api/v1/admin/security-reports/${reportId}`, {
      method: "POST",
    });
    setBusy(false);
    if (!result.success) {
      setError(result.error.message);
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-2">
      {reviewed ? (
        <span className="text-sm font-medium text-emerald-800">{t.securityReportReviewed}</span>
      ) : (
        <Button type="button" size="sm" onClick={markReviewed} disabled={busy}>
          {t.securityReportReview}
        </Button>
      )}
      {error && <FormMessage tone="error">{error}</FormMessage>}
    </div>
  );
}
