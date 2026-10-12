"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  FormMessage,
  Input,
  Label,
  RequiredLegend,
  Textarea,
} from "@/components/ui/field";
import { apiRequest } from "@/lib/api-client";
import { copy, type Locale } from "@/lib/i18n";

const selectStyles =
  "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30";

export type AllocationOption = {
  id: number;
  label: string;
  coaCode: string;
  fundSourceCode: string;
  available: number;
};

export type ReferenceOption = {
  id: number;
  code: string;
  name: string;
};

/**
 * Prepares an appropriation. Only verified COA accounts and verified fund
 * sources are offered — the schema and the API reject the rest anyway.
 */
export function AllocationForm({
  fiscalYears,
  fundSources,
  coaAccounts,
  offices,
  locale = "en",
}: {
  fiscalYears: Array<{ id: number; year: number; isClosed: boolean }>;
  fundSources: ReferenceOption[];
  coaAccounts: ReferenceOption[];
  offices: Array<{ id: number; name: string }>;
  locale?: Locale;
}) {
  const t = copy[locale].revamp.treasuryDesk;
  const common = copy[locale].revamp.common;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const openYears = fiscalYears.filter((year) => !year.isClosed);

  if (!open) {
    return (
      <Button type="button" onClick={() => setOpen(true)}>
        {t.newAllocation}
      </Button>
    );
  }

  async function submit(formData: FormData) {
    setBusy(true);
    setError(null);
    setDone(null);

    const officeId = String(formData.get("officeId") ?? "");
    const notes = String(formData.get("notes") ?? "");

    const result = await apiRequest<{ allocationId: number }>(
      "/api/v1/treasury/allocations",
      {
        method: "POST",
        body: JSON.stringify({
          fiscalYearId: Number(formData.get("fiscalYearId")),
          fundSourceId: Number(formData.get("fundSourceId")),
          coaAccountId: Number(formData.get("coaAccountId")),
          officeId: officeId === "" ? null : Number(officeId),
          label: String(formData.get("label") ?? ""),
          appropriation: Number(formData.get("appropriation")),
          notes: notes === "" ? null : notes,
        }),
      }
    );

    setBusy(false);
    if (!result.success) {
      setError(result.error.message);
      return;
    }
    setDone(t.allocationCreated);
    setOpen(false);
    router.refresh();
  }

  return (
    <form action={submit} className="space-y-4">
      <RequiredLegend>{t.requiredLegend}</RequiredLegend>
      {error && <FormMessage tone="error">{error}</FormMessage>}
      {done && <FormMessage tone="success">{done}</FormMessage>}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="allocation-label" required>
            {t.allocationLabel}
          </Label>
          <Input
            id="allocation-label"
            name="label"
            required
            maxLength={200}
            placeholder="MOOE 2026 — Repairs and maintenance"
          />
        </div>
        <div>
          <Label htmlFor="allocation-appropriation" required>
            {t.appropriation}
          </Label>
          <Input
            id="allocation-appropriation"
            name="appropriation"
            type="number"
            min="0.01"
            step="0.01"
            required
          />
        </div>
        <div>
          <Label htmlFor="allocation-fiscal-year" required>
            {t.fiscalYear}
          </Label>
          <select
            id="allocation-fiscal-year"
            name="fiscalYearId"
            required
            defaultValue={openYears[0]?.id}
            className={selectStyles}
          >
            {openYears.map((year) => (
              <option key={year.id} value={year.id}>
                {year.year}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="allocation-fund-source" required>
            {t.fundSource}
          </Label>
          <select
            id="allocation-fund-source"
            name="fundSourceId"
            required
            className={selectStyles}
          >
            {fundSources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.code} — {source.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="allocation-coa" required>
            {t.coaAccount}
          </Label>
          <select
            id="allocation-coa"
            name="coaAccountId"
            required
            className={selectStyles}
          >
            {coaAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.code} — {account.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="allocation-office">{t.office}</Label>
          <select
            id="allocation-office"
            name="officeId"
            defaultValue=""
            className={selectStyles}
          >
            <option value="">{t.officeWideWard}</option>
            {offices.map((office) => (
              <option key={office.id} value={office.id}>
                {office.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <Label htmlFor="allocation-notes">{t.verificationNotes}</Label>
        <Textarea id="allocation-notes" name="notes" rows={2} maxLength={500} />
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? common.saving : t.createAllocation}
        </Button>
        <Button
          type="button"
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
