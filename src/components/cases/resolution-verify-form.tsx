"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FormMessage, Label, Textarea } from "@/components/ui/field";
import { apiRequest } from "@/lib/api-client";
import { copy, type Locale } from "@/lib/i18n";

const selectStyles =
  "h-10 w-full rounded-control border border-line-strong bg-surface px-3 text-sm text-ink focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30";

/**
 * Verification before closure: check the proof attached to the resolution.
 * The API refuses when the verifier is the official who recorded it.
 */
export function ResolutionVerifyForm({
  concernId,
  locale = "en",
  recordedById,
}: {
  concernId: number;
  locale?: Locale;
  recordedById: number | null;
}) {
  const t = copy[locale].revamp.workflow;
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    const data = new FormData(event.currentTarget);
    const payload = {
      verificationStatus: String(data.get("verificationStatus") ?? ""),
      notes: String(data.get("notes") ?? ""),
    };

    setSubmitting(true);
    const result = await apiRequest<{ verificationStatus: string }>(
      `/api/v1/concerns/${concernId}/resolutions/verify`,
      { method: "POST", body: JSON.stringify(payload) }
    );
    setSubmitting(false);

    if (!result.success) {
      setError(result.error.message);
      return;
    }
    setSuccess(t.verifySaved);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {success && <FormMessage tone="success">{success}</FormMessage>}
      {error && <FormMessage tone="error">{error}</FormMessage>}

      <div>
        <Label htmlFor="verify-status" required>
          {t.verifyStatus}
        </Label>
        <select
          id="verify-status"
          name="verificationStatus"
          required
          defaultValue="FIXED_VERIFIED"
          className={selectStyles}
        >
          <option value="FIXED_VERIFIED">{t.verifyFixed}</option>
          <option value="PARTIALLY_VERIFIED">{t.verifyPartial}</option>
          <option value="FAILED">{t.verifyFailed}</option>
          <option value="PENDING_RESIDENT_CONFIRMATION">{t.verifyResident}</option>
        </select>
      </div>

      <div>
        <Label htmlFor="verify-notes" required>
          {t.verifyNotes}
        </Label>
        <Textarea id="verify-notes" name="notes" rows={3} maxLength={1000} required />
      </div>

      <Button type="submit" disabled={submitting} loading={submitting}>
        {t.verifySubmit}
      </Button>
      {recordedById !== null && (
        <p className="text-xs text-ink-subtle">{t.verifyBlocked}</p>
      )}
    </form>
  );
}
