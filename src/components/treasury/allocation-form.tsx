"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  FieldHint,
  FormMessage,
  Input,
  Label,
  RequiredLegend,
  Textarea,
} from "@/components/ui/field";
import { apiRequest } from "@/lib/api-client";
import { copy, type Locale } from "@/lib/i18n";

const selectStyles =
  "h-10 w-full rounded-control border border-line-strong bg-surface px-3 text-sm text-ink focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30";

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
  canOpenFiscalYear = false,
  locale = "en",
}: {
  fiscalYears: Array<{ id: number; year: number; isClosed: boolean }>;
  fundSources: ReferenceOption[];
  coaAccounts: ReferenceOption[];
  offices: Array<{ id: number; name: string }>;
  canOpenFiscalYear?: boolean;
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
  const recommendedYear = [...openYears].sort((a, b) => b.year - a.year)[0];

  if (openYears.length === 0) {
    return (
      <div className="space-y-2">
        <p role="status" className="text-sm text-ink-muted">
          {t.noOpenFiscalYear}
        </p>
        {canOpenFiscalYear ? (
          <Button href="/admin/treasury" size="sm" variant="outline">
            {t.createFiscalYear}
          </Button>
        ) : (
          <p className="text-xs text-ink-subtle">
            {t.askAdminToOpenFiscalYear}
          </p>
        )}
      </div>
    );
  }

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

    const fiscalYearId = Number(formData.get("fiscalYearId"));
    const fundSourceId = Number(formData.get("fundSourceId"));
    const coaAccountId = Number(formData.get("coaAccountId"));
    const officeId = String(formData.get("officeId") ?? "");
    const notes = String(formData.get("notes") ?? "");
    const year = openYears.find((item) => item.id === fiscalYearId);
    const fundSource = fundSources.find((item) => item.id === fundSourceId);
    const coaAccount = coaAccounts.find((item) => item.id === coaAccountId);
    const officeName =
      officeId === ""
        ? t.officeWideWard
        : offices.find((item) => String(item.id) === officeId)?.name;
    const label = [
      year ? `FY ${year.year}` : `FY ${fiscalYearId}`,
      fundSource?.code,
      coaAccount?.code,
      coaAccount?.name,
      officeName,
    ]
      .filter(Boolean)
      .join(" — ")
      .slice(0, 160);

    const result = await apiRequest<{ allocationId: number }>(
      "/api/v1/treasury/allocations",
      {
        method: "POST",
        body: JSON.stringify({
          fiscalYearId,
          fundSourceId,
          coaAccountId,
          officeId: officeId === "" ? null : Number(officeId),
          label,
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
          <Label htmlFor="allocation-fiscal-year" required>
            {t.fiscalYear}
          </Label>
          <select
            id="allocation-fiscal-year"
            name="fiscalYearId"
            required
            defaultValue={recommendedYear?.id ?? ""}
            className={selectStyles}
          >
            {openYears.map((year) => (
              <option key={year.id} value={year.id}>
                {year.year}
                {year.id === recommendedYear?.id && ` (${t.recommended})`}
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
            defaultValue=""
            className={selectStyles}
          >
            <option value="">{t.selectFundSource}</option>
            {fundSources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.code} — {source.name}
              </option>
            ))}
          </select>
          <FieldHint>{t.verifiedFundSourceHelp}</FieldHint>
        </div>
        <div>
          <Label htmlFor="allocation-coa" required>
            {t.coaAccount}
          </Label>
          <select
            id="allocation-coa"
            name="coaAccountId"
            required
            defaultValue=""
            className={selectStyles}
          >
            <option value="">{t.selectCoaAccount}</option>
            {coaAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.code} — {account.name}
              </option>
            ))}
          </select>
          <FieldHint>{t.verifiedCoaAccountHelp}</FieldHint>
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
        <div>
          <Label htmlFor="allocation-appropriation" required>
            {t.appropriationAmount}
          </Label>
          <Input
            id="allocation-appropriation"
            name="appropriation"
            type="number"
            min="0.01"
            step="0.01"
            required
          />
          <FieldHint>{t.appropriationHelp}</FieldHint>
        </div>
        <div>
          <p className="text-sm font-medium text-ink-muted">{t.allocationLabel}</p>
          <FieldHint>{t.allocationLabelAuto}</FieldHint>
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
