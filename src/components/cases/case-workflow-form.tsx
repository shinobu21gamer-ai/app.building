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

const selectStyles =
  "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30";

const STATUS_ACTION_LABEL: Record<string, string> = {
  IN_PROGRESS: "Start working (mark in progress)",
  RESOLVED: "Resolve the case",
  CLOSED: "Close the case",
};

export function CaseWorkflowForm({
  concernId,
  currentStatus,
  allowedTransitions,
}: {
  concernId: number;
  currentStatus: string;
  allowedTransitions: string[];
}) {
  const router = useRouter();
  const [status, setStatus] = useState<string>(allowedTransitions[0] ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [remarksError, setRemarksError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (allowedTransitions.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        {currentStatus === "CLOSED"
          ? "This case is closed. No further status changes are possible."
          : "No status actions are available for this case."}
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
      setRemarksError("Provide remarks for the status change (at least 5 characters).");
      return;
    }

    if (needsResolution) {
      const summary = String(formData.get("summary") ?? "").trim();
      const actionsTaken = String(formData.get("actionsTaken") ?? "").trim();
      const resolutionType = String(formData.get("resolutionType") ?? "");
      const attachment = formData.get("attachment");
      if (summary.length < 10 || actionsTaken.length < 10 || !resolutionType) {
        setFormError(
          "A resolution summary, the actions taken, and a resolution type are required."
        );
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
      `Case ${result.data.caseNumber} moved from ${result.data.fromStatus} to ${result.data.status}.`
    );
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {success && <FormMessage tone="success">{success}</FormMessage>}
      {formError && <FormMessage tone="error">{formError}</FormMessage>}

      <div>
        <Label htmlFor="workflow-status">Next action</Label>
        <select
          id="workflow-status"
          name="status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className={selectStyles}
        >
          {allowedTransitions.map((target) => (
            <option key={target} value={target}>
              {STATUS_ACTION_LABEL[target] ?? target}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-slate-500">
          Current status: {currentStatus}. Every change is recorded in the case
          history with your name and remarks.
        </p>
      </div>

      {needsResolution && (
        <div className="space-y-4 rounded-lg border border-emerald-200 bg-emerald-50/40 p-4">
          <p className="text-sm font-medium text-emerald-900">
            Resolution details
          </p>
          <div>
            <Label htmlFor="resolution-summary">Summary</Label>
            <Textarea
              id="resolution-summary"
              name="summary"
              rows={2}
              maxLength={2000}
              placeholder="Briefly describe the outcome."
            />
          </div>
          <div>
            <Label htmlFor="resolution-actions">Actions taken</Label>
            <Textarea
              id="resolution-actions"
              name="actionsTaken"
              rows={3}
              maxLength={2000}
              placeholder="What was actually done to address the concern?"
            />
          </div>
          <div>
            <Label htmlFor="resolution-type">Resolution type</Label>
            <select
              id="resolution-type"
              name="resolutionType"
              defaultValue="FIXED"
              className={selectStyles}
            >
              {RESOLUTION_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="resolution-resolved-on">
              Date resolved <span className="font-normal text-slate-500">(optional)</span>
            </Label>
            <input
              id="resolution-resolved-on"
              name="resolvedOn"
              type="date"
              className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30"
            />
            <p className="mt-1 text-xs text-slate-500">
              Defaults to today. Use this when the work finished on an earlier
              calendar day.
            </p>
          </div>
          <div>
            <Label htmlFor="resolution-attachment">
              Photo of the fix <span className="font-normal text-slate-500">(optional)</span>
            </Label>
            <input
              id="resolution-attachment"
              name="attachment"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30 file:mr-4 file:rounded-lg file:border-0 file:bg-brand-50 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-brand-700 hover:file:bg-brand-100"
            />
            <p className="mt-1 text-xs text-slate-500">
              JPEG, PNG, or WebP — max 5 MB. Residents will see this photo as proof of resolution.
            </p>
          </div>
        </div>
      )}

      <div>
        <Label htmlFor="workflow-remarks">Remarks</Label>
        <Textarea
          id="workflow-remarks"
          name="remarks"
          rows={3}
          maxLength={1000}
          placeholder="Explain this status change."
          invalid={Boolean(remarksError)}
        />
        {remarksError && <FieldError>{remarksError}</FieldError>}
      </div>

      <Button type="submit" disabled={submitting}>
        {submitting ? "Saving..." : "Update status"}
      </Button>
    </form>
  );
}
