"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FormMessage, Label, Select, Textarea } from "@/components/ui/field";
import { apiRequest } from "@/lib/api-client";
import { joinNames } from "@/lib/cases/verification-rules";
import { copy, type Locale } from "@/lib/i18n";

/**
 * Verification before closure: check the proof attached to the resolution.
 *
 * The API refuses when the verifier is the official who recorded it, so this
 * form is only ever rendered for someone the server will accept — the page
 * decides that with `verificationActorState` and renders `VerifyBlockedNotice`
 * for the recorder instead. Nothing here says "you cannot do this" to someone
 * who can: that hint used to show to everyone, including colleagues who had
 * every right to verify.
 */
export function ResolutionVerifyForm({
  concernId,
  locale = "en",
}: {
  concernId: number;
  locale?: Locale;
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
        <Select
          id="verify-status"
          name="verificationStatus"
          required
          defaultValue="FIXED_VERIFIED"
        >
          <option value="FIXED_VERIFIED">{t.verifyFixed}</option>
          <option value="PARTIALLY_VERIFIED">{t.verifyPartial}</option>
          <option value="FAILED">{t.verifyFailed}</option>
          <option value="PENDING_RESIDENT_CONFIRMATION">{t.verifyResident}</option>
        </Select>
        <p className="mt-1 text-caption text-ink-subtle">{t.verifyDecisionHelp}</p>
      </div>

      <div>
        <Label htmlFor="verify-notes" required>
          {t.verifyNotes}
        </Label>
        <Textarea id="verify-notes" name="notes" rows={3} maxLength={1000} required />
      </div>

      <div className="space-y-2">
        <Button type="submit" disabled={submitting} loading={submitting}>
          {t.verifySubmit}
        </Button>
        <p className="text-caption text-ink-subtle">{t.verifyWhoHelp}</p>
      </div>
    </form>
  );
}

/**
 * What the recorder sees instead of the form: the rule, and — by name — who
 * can act on it. A button that can only be refused is worse than no button,
 * and "ask a colleague" is not an instruction anyone can follow: the office's
 * own officials are named (`verificationAskNames`), because they are the
 * people who can open this case, and the Barangay Captain is named when that
 * office has nobody else.
 */
export function VerifyBlockedNotice({
  locale = "en",
  officeName = null,
  askNames = [],
  canSeeAllCases = false,
}: {
  locale?: Locale;
  /** The office holding the case, for the fallback sentence. */
  officeName?: string | null;
  /** The people who can verify it, by name. Empty when nobody is on file. */
  askNames?: string[];
  /** The Captain (or an admin) can open any case, so the way there is shown. */
  canSeeAllCases?: boolean;
}) {
  const t = copy[locale].revamp.workflow;
  const desk = officeName ?? t.verifyColleagueFallback;
  const names = joinNames(askNames, { locale });

  return (
    <div className="space-y-3">
      <div className="space-y-1 rounded-control border border-amber-200 bg-amber-50 px-3 py-2.5">
        <p className="text-sm font-semibold text-amber-900">
          {t.verifyBlockedTitle}
        </p>
        <p className="text-sm leading-relaxed text-amber-800">
          {t.verifyBlockedIntro}
        </p>
        <p className="text-sm leading-relaxed text-amber-800">
          {names === ""
            ? t.verifyBlocked.replaceAll("{desk}", desk)
            : t.verifyBlockedAsk.replaceAll("{names}", names)}
        </p>
      </div>
      <p className="text-sm leading-relaxed text-ink-muted">
        {t.verifyBlockedNext}
      </p>
      {canSeeAllCases && (
        <Button href="/captain/closure" size="sm" variant="outline">
          {t.verifyBlockedCaptain}
        </Button>
      )}
    </div>
  );
}
