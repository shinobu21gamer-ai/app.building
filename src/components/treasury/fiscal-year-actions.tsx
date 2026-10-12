"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  FormMessage,
  Label,
  RequiredLegend,
  Textarea,
} from "@/components/ui/field";
import { apiRequest } from "@/lib/api-client";
import { copy, type Locale } from "@/lib/i18n";

/**
 * Closes a fiscal year. The API refuses while any approved allocation is still
 * open, so a closed year can never hide a running appropriation.
 */
export function FiscalYearActions({
  fiscalYearId,
  isClosed,
  locale = "en",
}: {
  fiscalYearId: number;
  isClosed: boolean;
  locale?: Locale;
}) {
  const t = copy[locale].revamp.treasuryDesk;
  const common = copy[locale].revamp.common;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isClosed) return null;

  if (!open) {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
      >
        {t.closeFiscalYear}
      </Button>
    );
  }

  async function submit(formData: FormData) {
    setBusy(true);
    setError(null);

    const notes = String(formData.get("notes") ?? "");

    const result = await apiRequest<{ year: number }>(
      `/api/v1/admin/treasury/fiscal-years/${fiscalYearId}`,
      {
        method: "PATCH",
        body: JSON.stringify({ notes: notes === "" ? null : notes }),
      }
    );

    setBusy(false);
    if (!result.success) {
      setError(result.error.message);
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <form action={submit} className="space-y-3">
      <RequiredLegend>{t.requiredLegend}</RequiredLegend>
      {error && <FormMessage tone="error">{error}</FormMessage>}

      <div>
        <Label htmlFor={`fiscal-year-notes-${fiscalYearId}`}>
          {t.verificationNotes}
        </Label>
        <Textarea
          id={`fiscal-year-notes-${fiscalYearId}`}
          name="notes"
          rows={2}
          maxLength={500}
        />
      </div>

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? common.saving : t.closeFiscalYear}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setOpen(false)}
          disabled={busy}
        >
          {common.cancel}
        </Button>
      </div>
    </form>
  );
}
