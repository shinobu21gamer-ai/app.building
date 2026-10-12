"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  FormMessage,
  Input,
  Label,
  RequiredLegend,
} from "@/components/ui/field";
import { apiRequest } from "@/lib/api-client";
import { copy, type Locale } from "@/lib/i18n";

/** Opens a fiscal year. Everything in the treasury hangs off this frame. */
export function FiscalYearForm({ locale = "en" }: { locale?: Locale }) {
  const t = copy[locale].revamp.treasuryDesk;
  const common = copy[locale].revamp.common;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <Button type="button" onClick={() => setOpen(true)}>
        {t.createFiscalYear}
      </Button>
    );
  }

  async function submit(formData: FormData) {
    setBusy(true);
    setError(null);

    const name = String(formData.get("name") ?? "");

    const result = await apiRequest<{ fiscalYearId: number }>(
      "/api/v1/admin/treasury/fiscal-years",
      {
        method: "POST",
        body: JSON.stringify({
          year: Number(formData.get("year")),
          name: name === "" ? null : name,
          startsOn: String(formData.get("startsOn") ?? ""),
          endsOn: String(formData.get("endsOn") ?? ""),
        }),
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

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="fiscal-year-year" required>
            {t.fiscalYearYear}
          </Label>
          <Input
            id="fiscal-year-year"
            name="year"
            type="number"
            min="2000"
            max="2100"
            required
            placeholder="2026"
          />
        </div>
        <div>
          <Label htmlFor="fiscal-year-name">{t.yearName}</Label>
          <Input
            id="fiscal-year-name"
            name="name"
            maxLength={80}
            placeholder="Fiscal year 2026"
          />
        </div>
        <div>
          <Label htmlFor="fiscal-year-start" required>
            {t.startsOn}
          </Label>
          <Input
            id="fiscal-year-start"
            name="startsOn"
            type="date"
            required
          />
        </div>
        <div>
          <Label htmlFor="fiscal-year-end" required>
            {t.endsOn}
          </Label>
          <Input id="fiscal-year-end" name="endsOn" type="date" required />
        </div>
      </div>

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? common.saving : t.createFiscalYear}
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
