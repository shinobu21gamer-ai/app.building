"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  FormMessage,
  Input,
  Label,
  Textarea,
} from "@/components/ui/field";
import { PhotoPicker } from "@/components/ui/photo-picker";
import { apiRequest } from "@/lib/api-client";
import { formCalendarDayProblem } from "@/lib/cases/action-date";
import { RESOLUTION_TYPES } from "@/lib/cases/workflow";
import { formatCalendarDay } from "@/lib/format";
import { copy, type Locale } from "@/lib/i18n";

const selectStyles =
  "h-10 w-full rounded-control border border-line-strong bg-surface px-3 text-sm text-ink focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30";

/**
 * Records the resolution and moves the case to RESOLVED. A proof photo of the
 * fix is required, like every other status change.
 */
export function ResolutionForm({
  concernId,
  locale = "en",
  today,
  earliestDay,
}: {
  concernId: number;
  locale?: Locale;
  /** Today in Asia/Manila (YYYY-MM-DD); the latest allowed resolution date. */
  today: string;
  /** Earliest allowed resolution date (YYYY-MM-DD). */
  earliestDay: string;
}) {
  const t = copy[locale].desk;
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setSuccess(null);

    const form = event.currentTarget;
    const data = new FormData(form);
    const summary = String(data.get("summary") ?? "").trim();
    const actionsTaken = String(data.get("actionsTaken") ?? "").trim();
    const remarks = String(data.get("remarks") ?? "").trim();
    const resolvedOn = String(data.get("resolvedOn") ?? "").trim();

    if (summary.length < 10 || actionsTaken.length < 10) {
      setFormError(t.summaryActionsRequired);
      return;
    }
    if (remarks.length < 5) {
      setFormError(t.remarksRequired);
      return;
    }
    const dateProblem = formCalendarDayProblem(resolvedOn, earliestDay, today);
    if (dateProblem === "invalid") {
      setFormError(t.actionDateInvalid);
      return;
    }
    if (dateProblem === "future") {
      setFormError(t.actionDateFuture);
      return;
    }
    if (dateProblem === "too-old") {
      setFormError(
        t.actionDateTooOld.replace("{date}", formatCalendarDay(earliestDay))
      );
      return;
    }
    const file = data.get("attachment");
    if (!(file instanceof File) || file.size === 0) {
      setFormError(t.proofRequired);
      return;
    }

    const body = new FormData();
    body.set("summary", summary);
    body.set("actionsTaken", actionsTaken);
    body.set("remarks", remarks);
    body.set(
      "resolutionType",
      String(data.get("resolutionType") ?? "FIXED")
    );
    if (resolvedOn) body.set("resolvedOn", resolvedOn);
    body.set("attachment", file);

    setSubmitting(true);
    const result = await apiRequest<{
      caseNumber: string;
      status: string;
      resolution: { resolvedOn: string };
    }>(`/api/v1/concerns/${concernId}/resolutions`, {
      method: "POST",
      body,
    });
    setSubmitting(false);

    if (!result.success) {
      if (
        result.error.code === "VALIDATION_ERROR" &&
        Array.isArray(result.error.details)
      ) {
        const details = result.error.details as { message: string }[];
        setFormError(details.map((d) => d.message).join(" "));
      } else {
        setFormError(result.error.message);
      }
      return;
    }

    form.reset();
    setSuccess(
      t.resolvedNotify
        .replace("{caseNumber}", result.data.caseNumber)
        .replace("{status}", result.data.status)
    );
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {success && <FormMessage tone="success">{success}</FormMessage>}
      {formError && <FormMessage tone="error">{formError}</FormMessage>}

      <div>
        <Label htmlFor="resolution-summary" required>{t.resolutionDescription}</Label>
        <Textarea
          id="resolution-summary"
          name="summary"
          rows={2}
          maxLength={2000}
          placeholder={t.resolutionDescPlaceholder}
        />
      </div>

      <div>
        <Label htmlFor="resolution-actions" required>{t.actionTaken}</Label>
        <Textarea
          id="resolution-actions"
          name="actionsTaken"
          rows={3}
          maxLength={2000}
          placeholder={t.actionsPlaceholder}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="resolution-type" required>{t.resolutionType}</Label>
          <select
            id="resolution-type"
            name="resolutionType"
            defaultValue="FIXED"
            className={selectStyles}
          >
            {RESOLUTION_TYPES.map((type) => (
              <option key={type} value={type}>
                {t.types[type]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="resolution-on">{t.resolutionDate}</Label>
          <Input
            id="resolution-on"
            name="resolvedOn"
            type="date"
            defaultValue={today}
            min={earliestDay}
            max={today}
          />
          <p className="mt-1 text-xs text-ink-subtle">
            {t.actionDateHint.replace("{date}", formatCalendarDay(earliestDay))}
          </p>
        </div>
      </div>

      <div>
        <PhotoPicker
          id="resolution-attachment"
          name="attachment"
          label={t.proofPhoto}
          required
          hint={t.proofPhotoHint}
          locale={locale}
        />
      </div>

      <div>
        <Label htmlFor="resolution-remarks" required>{t.remarks}</Label>
        <Textarea
          id="resolution-remarks"
          name="remarks"
          rows={2}
          maxLength={1000}
          placeholder={t.remarksJournalPlaceholder}
        />
      </div>

      <Button type="submit" disabled={submitting}>
        {submitting ? t.saving : t.markResolved}
      </Button>
    </form>
  );
}
