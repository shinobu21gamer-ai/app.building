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
import { formatPeso } from "@/lib/cases/manpower";
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

/**
 * Proposes an earmark: a slice of an allocation set aside for a purpose or a
 * case. Proposing reserves nothing — the amount is checked when it is approved.
 */
export function EarmarkForm({
  allocations,
  caseOptions = [],
  presetAllocationId = null,
  presetConcernId = null,
  locale = "en",
}: {
  allocations: AllocationOption[];
  caseOptions?: Array<{ id: number; caseNumber: string; title: string }>;
  presetAllocationId?: number | null;
  presetConcernId?: number | null;
  locale?: Locale;
}) {
  const t = copy[locale].revamp.treasuryDesk;
  const common = copy[locale].revamp.common;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (allocations.length === 0) {
    return <p className="text-sm text-ink-subtle">{t.fundingMissing}</p>;
  }

  if (!open) {
    return (
      <Button type="button" onClick={() => setOpen(true)}>
        {t.newEarmark}
      </Button>
    );
  }

  async function submit(formData: FormData) {
    setBusy(true);
    setError(null);

    const concernId = String(formData.get("concernId") ?? "");
    const notes = String(formData.get("notes") ?? "");

    const result = await apiRequest<{ earmarkId: number; code: string | null }>(
      "/api/v1/treasury/earmarks",
      {
        method: "POST",
        body: JSON.stringify({
          allocationId: Number(formData.get("allocationId")),
          concernId: concernId === "" ? null : Number(concernId),
          purpose: String(formData.get("purpose") ?? ""),
          amount: Number(formData.get("amount")),
          notes: notes === "" ? null : notes,
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
    <form action={submit} className="space-y-4">
      <RequiredLegend>{t.requiredLegend}</RequiredLegend>
      {error && <FormMessage tone="error">{error}</FormMessage>}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="earmark-purpose" required>
            {t.earmarkPurpose}
          </Label>
          <Input
            id="earmark-purpose"
            name="purpose"
            required
            maxLength={200}
            placeholder="Repair of Barangay Hall comfort rooms"
          />
        </div>
        <div>
          <Label htmlFor="earmark-amount" required>
            {t.earmarkAmount}
          </Label>
          <Input
            id="earmark-amount"
            name="amount"
            type="number"
            min="0.01"
            step="0.01"
            required
          />
        </div>
        <div>
          <Label htmlFor="earmark-allocation" required>
            {t.budgetsTitle}
          </Label>
          <select
            id="earmark-allocation"
            name="allocationId"
            required
            defaultValue={presetAllocationId ?? allocations[0]?.id}
            className={selectStyles}
          >
            {allocations.map((allocation) => (
              <option key={allocation.id} value={allocation.id}>
                {allocation.coaCode} · {allocation.label} ·{" "}
                {formatPeso(allocation.available)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="earmark-case">{t.linkedCase}</Label>
          <select
            id="earmark-case"
            name="concernId"
            defaultValue={presetConcernId ?? ""}
            className={selectStyles}
          >
            <option value="">—</option>
            {caseOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.caseNumber} — {option.title}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <Label htmlFor="earmark-notes">{t.verificationNotes}</Label>
        <Textarea id="earmark-notes" name="notes" rows={2} maxLength={500} />
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? common.saving : t.proposeEarmark}
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
