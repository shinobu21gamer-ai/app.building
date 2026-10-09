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
import { apiRequest } from "@/lib/api-client";
import { RESOLUTION_TYPES } from "@/lib/cases/workflow";
import { copy, type Locale } from "@/lib/i18n";

const selectStyles =
  "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30";

export function CaseWorkflowForm({
  concernId,
  currentStatus,
  allowedTransitions,
  locale = "en",
}: {
  concernId: number;
  currentStatus: string;
  allowedTransitions: string[];
  locale?: Locale;
}) {
  const t = copy[locale].desk;
  const actionLabel: Record<string, string> = {
    IN_PROGRESS: t.startProgress,
    RESOLVED: t.resolveCase,
    CLOSED: t.closeCase,
  };
  const router = useRouter();
  const [status, setStatus] = useState<string>(allowedTransitions[0] ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [remarksError, setRemarksError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (allowedTransitions.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        {currentStatus === "CLOSED" ? t.closedNoChange : t.noActions}
      </p>
    );
  }

  const needsResolution = status === "RESOLVED";

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setRemarksError(null);
    setSuccess(null);

    const formData = new FormData(event.currentTarget);
    const remarks = String(formData.get("remarks") ?? "").trim();
    if (remarks.length < 5) {
      setRemarksError(t.remarksError);
      return;
    }

    if (needsResolution) {
      const summary = String(formData.get("summary") ?? "").trim();
      const actionsTaken = String(formData.get("actionsTaken") ?? "").trim();
      const resolutionType = String(formData.get("resolutionType") ?? "");
      const attachment = formData.get("attachment");
      if (summary.length < 10 || actionsTaken.length < 10 || !resolutionType) {
        setFormError(t.resolutionRequired);
        return;
      }
      formData.set("resolution", JSON.stringify({
        summary,
        actionsTaken,
        resolutionType,
        resolvedOn:
          String(formData.get("resolvedOn") ?? "").trim() || undefined,
      }));
      if (attachment instanceof File && attachment.size > 0) {
        // attachment is already in formData
      }
    }

    setSubmitting(true);
    const result = await apiRequest<{
      fromStatus: string;
      status: string;
      caseNumber: string;
    }>(`/api/v1/concerns/${concernId}/status`, {
      method: "POST",
      body: formData, // send FormData directly (handles file upload)
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
        <select
          id="workflow-status"
          name="status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className={selectStyles}
        >
          {allowedTransitions.map((target) => (
            <option key={target} value={target}>
              {actionLabel[target] ?? target}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-slate-500">
          {t.currentStatus.replace("{status}", currentStatus)}
        </p>
      </div>

      {needsResolution && (
        <div className="space-y-4 rounded-lg border border-emerald-200 bg-emerald-50/40 p-4">
          <p className="text-sm font-medium text-emerald-900">
            {t.resolutionDetails}
          </p>
          <div>
            <Label htmlFor="resolution-summary">{t.summary}</Label>
            <Textarea
              id="resolution-summary"
              name="summary"
              rows={2}
              maxLength={2000}
              placeholder={t.summaryPlaceholder}
            />
          </div>
          <div>
            <Label htmlFor="resolution-actions">{t.actionsTaken}</Label>
            <Textarea
              id="resolution-actions"
              name="actionsTaken"
              rows={3}
              maxLength={2000}
              placeholder={t.actionsPlaceholder}
            />
          </div>
          <div>
            <Label htmlFor="resolution-type">{t.resolutionType}</Label>
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
            <Label htmlFor="resolution-resolved-on">
              {t.dateResolved}{" "}
              <span className="font-normal text-slate-500">{t.optional}</span>
            </Label>
            <input
              id="resolution-resolved-on"
              name="resolvedOn"
              type="date"
              className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30"
            />
            <p className="mt-1 text-xs text-slate-500">
              {t.dateResolvedHint}
            </p>
          </div>
          <div>
            <Label htmlFor="resolution-attachment">
              {t.photoFix}{" "}
              <span className="font-normal text-slate-500">{t.optional}</span>
            </Label>
            <input
              id="resolution-attachment"
              name="attachment"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30 file:mr-4 file:rounded-lg file:border-0 file:bg-brand-50 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-brand-700 hover:file:bg-brand-100"
            />
            <p className="mt-1 text-xs text-slate-500">
              {t.photoFixHint}
            </p>
          </div>
        </div>
      )}

      <div>
        <Label htmlFor="workflow-remarks">{t.remarks}</Label>
        <Textarea
          id="workflow-remarks"
          name="remarks"
          rows={3}
          maxLength={1000}
          placeholder={t.remarksPlaceholder}
          invalid={Boolean(remarksError)}
        />
        {remarksError && <FieldError>{remarksError}</FieldError>}
      </div>

      <Button type="submit" disabled={submitting}>
        {submitting ? t.saving : t.updateStatus}
      </Button>
    </form>
  );
}
