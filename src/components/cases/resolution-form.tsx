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
import { apiRequest } from "@/lib/api-client";
import { RESOLUTION_TYPES } from "@/lib/cases/workflow";
import { copy, type Locale } from "@/lib/i18n";

const selectStyles =
  "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30";

function todayValue(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function ResolutionForm({
  concernId,
  locale = "en",
}: {
  concernId: number;
  locale?: Locale;
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

    const data = new FormData(event.currentTarget);
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

    const form = new FormData();
    form.set("summary", summary);
    form.set("actionsTaken", actionsTaken);
    form.set("remarks", remarks);
    form.set(
      "resolutionType",
      String(data.get("resolutionType") ?? "FIXED")
    );
    if (resolvedOn) form.set("resolvedOn", resolvedOn);
    const file = data.get("attachment");
    if (file instanceof File && file.size > 0) form.set("attachment", file);

    setSubmitting(true);
    const result = await apiRequest<{
      caseNumber: string;
      status: string;
      resolution: { resolvedOn: string };
    }>(`/api/v1/concerns/${concernId}/resolutions`, {
      method: "POST",
      body: form,
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
        <Label htmlFor="resolution-summary">{t.resolutionDescription}</Label>
        <Textarea
          id="resolution-summary"
          name="summary"
          rows={2}
          maxLength={2000}
          placeholder={t.resolutionDescPlaceholder}
        />
      </div>

      <div>
        <Label htmlFor="resolution-actions">{t.actionTaken}</Label>
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
          <Label htmlFor="resolution-on">{t.resolutionDate}</Label>
          <Input
            id="resolution-on"
            name="resolvedOn"
            type="date"
            max={todayValue()}
          />
          <p className="mt-1 text-xs text-slate-500">{t.dateHint}</p>
        </div>
      </div>

      <div>
        <Label htmlFor="resolution-attachment">{t.attachment}</Label>
        <Input
          id="resolution-attachment"
          name="attachment"
          type="file"
          accept="image/jpeg,image/png,image/webp"
        />
        <p className="mt-1 text-xs text-slate-500">{t.attachmentHint}</p>
      </div>

      <div>
        <Label htmlFor="resolution-remarks">{t.remarks}</Label>
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