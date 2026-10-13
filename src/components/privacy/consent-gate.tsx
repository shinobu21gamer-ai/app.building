"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/field";
import { apiRequest } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { copy, type Locale } from "@/lib/i18n";
import type { ConsentPurpose } from "@/lib/privacy/catalog";

/**
 * The one-click consent that unblocks an action.
 *
 * Residents who registered before consent records existed have no
 * `DATA_PROCESSING` row, so the API refuses their concern — with the message
 * pointing at a page they then have to go and find. This panel states the
 * purpose in full and records the grant in place, so the resident never fills
 * in a whole form that cannot be submitted.
 *
 * The server is the source of truth: the grant is an ordinary
 * `POST /api/v1/privacy/consents` and the page re-renders from it afterwards.
 */
export function ConsentGate({
  purpose,
  label,
  description,
  requiredAtSignup = false,
  locale = "en",
}: {
  purpose: ConsentPurpose;
  label: string;
  description: string;
  requiredAtSignup?: boolean;
  locale?: Locale;
}) {
  const t = copy[locale].revamp.privacyCenter;
  const router = useRouter();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function grant() {
    setBusy(true);
    setError(null);
    const result = await apiRequest(`/api/v1/privacy/consents`, {
      method: "POST",
      body: JSON.stringify({ purpose }),
    });
    setBusy(false);
    if (!result.success) {
      setError(result.error.message);
      return;
    }
    showToast("success", t.consentGranted);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="rounded-control border border-line bg-surface-muted px-4 py-3">
        <p className="text-sm font-medium text-ink">
          {label}
          {requiredAtSignup && (
            <span className="ml-2 align-middle text-xs font-normal text-ink-subtle">
              *
            </span>
          )}
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">
          {description}
        </p>
      </div>

      {error && <FormMessage tone="error">{error}</FormMessage>}

      <Button type="button" loading={busy} disabled={busy} onClick={grant}>
        {busy ? t.consentGranting : t.consentGrant}
      </Button>
    </div>
  );
}
