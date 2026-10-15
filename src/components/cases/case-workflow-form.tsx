"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  FieldError,
  FormMessage,
  Label,
  Textarea,
} from "@/components/ui/field";
import { PhotoPicker } from "@/components/ui/photo-picker";
import { apiRequest } from "@/lib/api-client";
import { formCalendarDayProblem } from "@/lib/cases/action-date";
import { formatCalendarDay } from "@/lib/format";
import { copy, type Locale } from "@/lib/i18n";

const selectStyles =
  "h-10 w-full rounded-control border border-line-strong bg-surface px-3 text-sm text-ink focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30";


/**
 * Moves a case to IN_PROGRESS or CLOSED. Every status change needs a proof
 * photo, so the form cannot be submitted without one. RESOLVED has its own
 * form (ResolutionForm) because it also records the resolution details.
 */
export function CaseWorkflowForm({
  concernId,
  currentStatus,
  allowedTransitions,
  locale = "en",
  today,
  earliestDay,
}: {
  concernId: number;
  currentStatus: string;
  allowedTransitions: string[];
  locale?: Locale;
  /** Today in Asia/Manila (YYYY-MM-DD); the latest allowed action date. */
  today: string;
  /** Earliest allowed action date (YYYY-MM-DD) for a status change. */
  earliestDay: string;
}) {
  const t = copy[locale].desk;
  const actionLabel: Record<string, string> = {
    UNDER_ASSESSMENT: t.startAssessment,
    AWAITING_BUDGET: t.moveToBudget,
    IN_PROGRESS: t.startProgress,
    CLOSED: t.closeCase,
  };
  const router = useRouter();
  const [chosen, setChosen] = useState<string>(allowedTransitions[0] ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [remarksError, setRemarksError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (allowedTransitions.length === 0) {
    return (
      <p className="text-sm text-ink-subtle">
        {currentStatus === "CLOSED" ? t.closedNoChange : t.noActions}
      </p>
    );
  }

  // Keep the selection valid when the allowed transitions change after a
  // successful update (the page re-renders with the new status).
  const status = allowedTransitions.includes(chosen)
    ? chosen
    : (allowedTransitions[0] ?? "");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setRemarksError(null);
    setSuccess(null);

    const form = event.currentTarget;
    const formData = new FormData(form);
    const remarks = String(formData.get("remarks") ?? "").trim();
    if (remarks.length < 5) {
      setRemarksError(t.remarksError);
      return;
    }
    const occurredOn = String(formData.get("occurredOn") ?? "").trim();
    const dateProblem = formCalendarDayProblem(occurredOn, earliestDay, today);
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

    const proof = formData.get("attachment");
    if (!(proof instanceof File) || proof.size === 0) {
      setFormError(t.proofRequired);
      return;
    }

    setSubmitting(true);
    const result = await apiRequest<{
      fromStatus: string;
      status: string;
      caseNumber: string;
    }>(`/api/v1/concerns/${concernId}/status`, {
      method: "POST",
      body: formData, // multipart: carries the proof photo
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
      t.successMove
        .replace("{caseNumber}", result.data.caseNumber)
        .replace("{from}", result.data.fromStatus)
        .replace("{to}", result.data.status)
    );
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {success && <FormMessage tone="success">{success}</FormMessage>}
      {formError && <FormMessage tone="error">{formError}</FormMessage>}

      <div>
        <Label htmlFor="workflow-status">{t.nextAction}</Label>
        {/* Inside a flow step there is exactly one correct next status, so it is
            stated rather than offered as a one-option dropdown. */}
        {allowedTransitions.length > 1 ? (
          <select
            id="workflow-status"
            name="status"
            value={status}
            onChange={(event) => setChosen(event.target.value)}
            className={selectStyles}
          >
            {allowedTransitions.map((target) => (
              <option key={target} value={target}>
                {actionLabel[target] ?? target}
              </option>
            ))}
          </select>
        ) : (
          <>
            <input type="hidden" name="status" value={status} />
            <p className="rounded-control border border-line bg-surface-sunken px-3 py-2 text-sm font-semibold text-ink">
              {actionLabel[status] ?? status}
            </p>
          </>
        )}
        <p className="mt-1 text-xs text-ink-subtle">
          {t.currentStatus.replace("{status}", currentStatus)}
        </p>
      </div>

      <div>
        <Label htmlFor="workflow-action-date">{t.actionDate}</Label>
        <input
          id="workflow-action-date"
          name="occurredOn"
          type="date"
          defaultValue={today}
          min={earliestDay}
          max={today}
          className={selectStyles}
        />
        <p className="mt-1 text-xs text-ink-subtle">
          {t.actionDateHint.replace("{date}", formatCalendarDay(earliestDay))}
        </p>
      </div>

      <div>
        <PhotoPicker
          id="workflow-proof"
          name="attachment"
          label={t.proofPhoto}
          required
          hint={t.proofPhotoHint}
          locale={locale}
        />
      </div>

      <div>
        <Label htmlFor="workflow-override">{t.workflowOverrideLabel}</Label>
        <Textarea
          id="workflow-override"
          name="overrideReason"
          rows={2}
          maxLength={1000}
          placeholder={t.workflowOverridePlaceholder}
        />
      </div>

      <div>
        <Label htmlFor="workflow-remarks">{t.remarks}</Label>
        <Textarea
          id="workflow-remarks"
          name="remarks"
          rows={3}
          maxLength={1000}
          placeholder={t.remarksPlaceholder}
          invalid={Boolean(remarksError)}
          aria-describedby={remarksError ? "workflow-remarks-error" : undefined}
        />
        {remarksError && <FieldError id="workflow-remarks-error">{remarksError}</FieldError>}
      </div>

      <Button type="submit" disabled={submitting}>
        {submitting ? t.saving : t.updateStatus}
      </Button>
    </form>
  );
}
