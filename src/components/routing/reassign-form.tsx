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
import { copy, type Locale } from "@/lib/i18n";

export type ReassignOffice = {
  id: number;
  name: string;
  code: string;
  officials: { id: number; firstName: string; lastName: string }[];
};

const selectStyles =
  "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30";

export function ReassignForm({
  concernId,
  offices,
  currentOfficeId,
  currentOfficialId,
  locale = "en",
}: {
  concernId: number;
  offices: ReassignOffice[];
  currentOfficeId: number | null;
  currentOfficialId: number | null;
  locale?: Locale;
}) {
  const t = copy[locale].desk;
  const router = useRouter();
  const initialOffice =
    currentOfficeId && offices.some((o) => o.id === currentOfficeId)
      ? currentOfficeId
      : (offices[0]?.id ?? null);

  const [officeId, setOfficeId] = useState<number | null>(initialOffice);
  const [officialId, setOfficialId] = useState<string>(
    currentOfficialId ? String(currentOfficialId) : ""
  );
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selectedOffice = offices.find((o) => o.id === officeId) ?? null;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setReasonError(null);
    setSuccess(null);

    if (!officeId) {
      setFormError(t.selectOffice);
      return;
    }

    const data = new FormData(event.currentTarget);
    const reason = String(data.get("reason") ?? "").trim();
    if (reason.length < 5) {
      setReasonError(t.assignReasonError);
      return;
    }

    const body: Record<string, unknown> = { officeId, reason };
    if (officialId) body.officialId = Number(officialId);

    setSubmitting(true);
    const result = await apiRequest<{
      assignment: { officeName: string; officialName: string | null; status: string };
      previousOfficeName: string | null;
    }>(`/api/v1/concerns/${concernId}/assignments`, {
      method: "POST",
      body: JSON.stringify(body),
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

    const { assignment } = result.data;
    const template = result.data.previousOfficeName
      ? assignment.officialName
        ? t.reassignedToOfficial
        : t.reassignedTo
      : assignment.officialName
        ? t.assignedToOfficial
        : t.assignedTo;
    setSuccess(
      template
        .replace("{office}", assignment.officeName)
        .replace("{official}", assignment.officialName ?? "")
    );
    router.refresh();
  }

  if (offices.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        {t.noOffices}
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {success && <FormMessage tone="success">{success}</FormMessage>}
      {formError && <FormMessage tone="error">{formError}</FormMessage>}

      <div>
        <Label htmlFor="assign-office">{t.assignOffice}</Label>
        <select
          id="assign-office"
          value={officeId ?? ""}
          onChange={(e) => {
            setOfficeId(e.target.value ? Number(e.target.value) : null);
            setOfficialId("");
          }}
          className={selectStyles}
        >
          {offices.map((office) => (
            <option key={office.id} value={office.id}>
              {office.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <Label htmlFor="assign-official">{t.assignOfficial}</Label>
        <select
          id="assign-official"
          value={officialId}
          onChange={(e) => setOfficialId(e.target.value)}
          className={selectStyles}
        >
          <option value="">{t.assignAny}</option>
          {(selectedOffice?.officials ?? []).map((official) => (
            <option key={official.id} value={official.id}>
              {official.firstName} {official.lastName}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-slate-500">
          {t.assignOfficialHint}
        </p>
      </div>

      <div>
        <Label htmlFor="assign-reason">{t.assignReason}</Label>
        <Textarea
          id="assign-reason"
          name="reason"
          rows={3}
          maxLength={500}
          placeholder={t.assignReasonPlaceholder}
          invalid={Boolean(reasonError)}
        />
        {reasonError && <FieldError>{reasonError}</FieldError>}
      </div>

      <Button type="submit" disabled={submitting}>
        {submitting ? t.saving : t.saveAssignment}
      </Button>
    </form>
  );
}
