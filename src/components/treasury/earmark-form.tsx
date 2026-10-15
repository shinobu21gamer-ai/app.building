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
  /** The office the line belongs to; null = barangay-wide. */
  officeName: string | null;
  available: number;
};

/**
 * Proposes an earmark: a slice of an allocation set aside for a purpose or a
 * case. Proposing reserves nothing — the amount is checked when it is approved.
 *
 * `presetConcernId` and `suggestedAmount` let a case's funding panel send the
 * treasurer here with the case already picked and the amount already sized to
 * what that case is still short, so the proposal is not typed from memory.
 */
export function EarmarkForm({
  allocations,
  caseOptions = [],
  presetAllocationId = null,
  presetConcernId = null,
  suggestedAmount = null,
  defaultOpen = false,
  locale = "en",
}: {
  allocations: AllocationOption[];
  /**
   * Cases the money can be linked to. The estimate and the amount already set
   * aside travel with each one, because the treasurer's job here is to reserve
   * enough to cover the estimate — and that is the number the case stops
   * waiting for (see `fundingGateForConcern`).
   */
  caseOptions?: Array<{
    id: number;
    caseNumber: string;
    title: string;
    estimate: number | null;
    /** Labour cost inside the estimate — the crew's share of the money. */
    laborCost: number | null;
    /** Workers named in the manpower plan, when the assessment has one. */
    workersNeeded: number | null;
    /** The office the case is assigned to — where the money goes to work. */
    officeName: string | null;
    officeHead: string | null;
    /** The official named on the case, when one is. */
    officialName: string | null;
    setAside: number;
    waitingForBudget: boolean;
  }>;
  presetAllocationId?: number | null;
  presetConcernId?: number | null;
  /** Prefills the amount with what the chosen case still needs. */
  suggestedAmount?: number | null;
  /** Opens the form straight away, for a deep link that arrives mid-task. */
  defaultOpen?: boolean;
  locale?: Locale;
}) {
  const t = copy[locale].revamp.treasuryDesk;
  const common = copy[locale].revamp.common;
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Controlled rather than defaultValue: picking a case re-sizes the amount
  // to that case's shortfall, which is the figure the treasurer should be
  // starting from (and the only one that unblocks the case).
  const [amount, setAmount] = useState<string>(
    suggestedAmount !== null && suggestedAmount > 0
      ? suggestedAmount.toFixed(2)
      : ""
  );
  const [selectedCaseId, setSelectedCaseId] = useState<number | null>(
    presetConcernId
  );

  // Arriving from a case, the purpose is already known: name the concern the
  // money is for, so the proposal says what it is without retyping the title.
  const presetCase =
    presetConcernId === null
      ? null
      : (caseOptions.find((option) => option.id === presetConcernId) ?? null);
  const presetPurpose = presetCase
    ? `${presetCase.caseNumber} — ${presetCase.title}`.slice(0, 200)
    : null;

  const selectedOption =
    selectedCaseId === null
      ? null
      : (caseOptions.find((option) => option.id === selectedCaseId) ?? null);

  // Where the money goes: the official named on the case if one is,
  // otherwise the office it is assigned to (with its head when we have it).
  const handledBy =
    selectedOption === null
      ? null
      : selectedOption.officialName !== null
        ? `${selectedOption.officialName} · ${
            selectedOption.officeName ?? t.earmarkBriefNoOffice
          }`
        : selectedOption.officeName !== null
          ? selectedOption.officeHead
            ? `${selectedOption.officeName} (${t.earmarkBriefHead.replace(
                "{name}",
                selectedOption.officeHead
              )})`
            : selectedOption.officeName
          : t.earmarkBriefNoOffice;

  const selectedShortfall =
    selectedOption !== null && selectedOption.estimate !== null
      ? Math.max(
          0,
          Math.round(
            (selectedOption.estimate - selectedOption.setAside) * 100
          ) / 100
        )
      : null;

  function handleCaseChange(value: string) {
    const id = value === "" ? null : Number(value);
    setSelectedCaseId(id);
    const option =
      id === null
        ? null
        : (caseOptions.find((item) => item.id === id) ?? null);
    // Re-size the amount to the case's remaining need so the treasurer is
    // not guessing at a figure the case has already computed.
    if (option !== null && option.estimate !== null) {
      const shortfall = Math.max(
        0,
        Math.round((option.estimate - option.setAside) * 100) / 100
      );
      setAmount(shortfall > 0 ? shortfall.toFixed(2) : "");
    }
  }

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
    // The input is `required` with a minimum of 0.01, so by the time the
    // browser hands the form over the figure is a positive number.
    const amountValue = Number(amount);

    const result = await apiRequest<{ earmarkId: number; code: string | null }>(
      "/api/v1/treasury/earmarks",
      {
        method: "POST",
        body: JSON.stringify({
          allocationId: Number(formData.get("allocationId")),
          concernId: concernId === "" ? null : Number(concernId),
          purpose: String(formData.get("purpose") ?? ""),
          amount: amountValue,
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
            defaultValue={presetPurpose ?? undefined}
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
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
          {selectedOption !== null && selectedOption.estimate !== null && (
            <p className="mt-1 text-xs text-ink-subtle">
              {t.earmarkAmountCaseHint}
            </p>
          )}
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
                {allocation.coaCode} · {allocation.label}
                {" · "}
                {allocation.officeName ?? t.officeWideWard}
                {" · "}
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
            value={selectedCaseId?.toString() ?? ""}
            onChange={(event) => handleCaseChange(event.target.value)}
            className={selectStyles}
          >
            <option value="">—</option>
            {caseOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.caseNumber} — {option.title}
                {option.waitingForBudget ? ` · ${t.caseWaitingForBudget}` : ""}
                {option.estimate === null
                  ? ` · ${t.caseNoEstimate}`
                  : ` · ${t.caseEstimate} ${formatPeso(option.estimate)}`}
                {option.setAside > 0
                  ? ` · ${t.caseSetAside} ${formatPeso(option.setAside)}`
                  : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* The brief the treasurer needs before typing a figure: who spends the
          money, what the estimate covers (crew labour included), what is
          already set aside, and how much the case is still short. */}
      {selectedOption !== null && handledBy !== null && (
        <div className="rounded-control border border-line bg-surface-sunken px-3 py-2.5">
          <p className="text-caption font-semibold uppercase tracking-wide text-ink-subtle">
            {t.earmarkWhereGoes}
          </p>
          <p className="mt-1 text-sm font-semibold text-ink">
            {selectedOption.caseNumber} — {selectedOption.title}
          </p>
          <p className="mt-2 text-sm text-ink-muted">
            {t.earmarkBriefHandledBy}: <span className="text-ink">{handledBy}</span>
          </p>
          {selectedOption.estimate === null ? (
            <p className="mt-1 text-sm text-amber-700">
              {t.earmarkBriefNoEstimate}
            </p>
          ) : (
            <div className="mt-2 space-y-1 text-sm">
              <p className="flex flex-wrap items-baseline justify-between gap-x-4">
                <span className="text-ink-muted">{t.earmarkBriefEstimate}</span>
                <span className="font-semibold tabular-nums text-ink">
                  {formatPeso(selectedOption.estimate)}
                </span>
              </p>
              {selectedOption.laborCost !== null &&
                selectedOption.laborCost > 0 && (
                  <p className="pl-3 text-xs text-ink-muted">
                    {t.earmarkBriefLabor.replace(
                      "{amount}",
                      formatPeso(selectedOption.laborCost)
                    ).replace(
                      "{count}",
                      selectedOption.workersNeeded !== null
                        ? String(selectedOption.workersNeeded)
                        : "—"
                    )}
                  </p>
                )}
              <p className="flex flex-wrap items-baseline justify-between gap-x-4">
                <span className="text-ink-muted">{t.earmarkBriefSetAside}</span>
                <span className="font-semibold tabular-nums text-ink">
                  {formatPeso(selectedOption.setAside)}
                </span>
              </p>
              {selectedShortfall !== null && selectedShortfall > 0 ? (
                <p className="flex flex-wrap items-baseline justify-between gap-x-4">
                  <span className="text-ink-muted">{t.earmarkBriefShortfall}</span>
                  <span className="font-semibold tabular-nums text-amber-700">
                    {formatPeso(selectedShortfall)}
                  </span>
                </p>
              ) : (
                <p className="font-semibold text-emerald-700">
                  {t.earmarkBriefCovered}
                </p>
              )}
              {selectedOption.laborCost !== null &&
                selectedOption.laborCost > 0 && (
                  <p className="border-t border-line pt-2 text-xs text-ink-subtle">
                    {t.earmarkCrewPaidNote}
                  </p>
                )}
            </div>
          )}
        </div>
      )}

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
