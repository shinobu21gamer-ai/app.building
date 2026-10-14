"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import { formatPeso } from "@/lib/cases/manpower";
import { copy, type Locale } from "@/lib/i18n";
import {
  coversInTotal,
  type RankedFundingOption,
} from "@/lib/treasury/funding-guide";

/**
 * The way out of a finished budget, stated where the dead end is: a link to
 * prepare a new allocation (the Captain approves it before it becomes
 * spendable) plus the two other ways money can appear — an administrator
 * topping up a line, and cancelled earmarks freeing their reservations.
 */
function AddBudgetActions({
  label,
  howTo,
}: {
  label: string;
  howTo: string;
}) {
  return (
    <div className="space-y-2 rounded-control border border-line bg-surface px-3 py-2.5">
      <Button href="/treasury/budgets" size="sm">
        {label}
      </Button>
      <p className="text-xs leading-relaxed text-ink-subtle">{howTo}</p>
    </div>
  );
}

/** The case facts the form needs, as computed by the funding guide. */
export type FundCaseFacts = {
  concernId: number;
  caseNumber: string;
  title: string;
  officeName: string | null;
  estimate: number | null;
  setAside: number;
  proposed: number;
  /** What a new proposal must cover (never double-counts pending proposals). */
  uncommitted: number;
};

/**
 * The guided way to fund one case, replacing the generic "new earmark" form
 * for this job. Three numbered steps, two of them already answered:
 *
 *   1. what the case needs — stated, not looked up (the treasurer cannot even
 *      open the case screens; those are scoped to the case's office);
 *   2. which budget pays — one option recommended, each option saying what it
 *      leaves behind, instead of a dropdown of COA object codes;
 *   3. the proposal itself — amount and purpose prefilled, so the whole job
 *      is one review and one click.
 *
 * After proposing, the success panel names the next desk out loud: the
 * Captain approves, and only that approval reserves the money.
 */
export function FundCaseForm({
  facts,
  options,
  canAddBudget = false,
  locale = "en",
}: {
  facts: FundCaseFacts;
  /** Ranked by `rankFundingOptions`; empty when no approved allocation
   *  exists at all, which the form reads as a setup gap rather than a
   *  "this budget is too small" situation. */
  options: RankedFundingOption[];
  /** Whether this reader may prepare a new allocation (Treasurer, Admin) —
   *  the "the money is finished" dead end is only actionable if it links to
   *  the way out. */
  canAddBudget?: boolean;
  locale?: Locale;
}) {
  const t = copy[locale].revamp.treasuryDesk.fundCase;
  const common = copy[locale].revamp.common;
  const router = useRouter();

  const recommendedId =
    options.find((option) => option.recommended)?.option.allocationId ??
    options[0]?.option.allocationId ??
    null;
  const [allocationId, setAllocationId] = useState<number | null>(recommendedId);
  const [amountText, setAmountText] = useState(
    facts.uncommitted > 0 ? facts.uncommitted.toFixed(2) : ""
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    earmarkId: number;
    code: string | null;
    amount: number;
  } | null>(null);

  if (options.length === 0) {
    return (
      <div className="space-y-2">
        <p className="rounded-control border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {t.noAllocations}
        </p>
        {canAddBudget && <AddBudgetActions label={t.addBudget} howTo={t.addBudgetHow} />}
      </div>
    );
  }

  // The cover notes track what is actually typed, so the "left after" figure
  // never quietly disagrees with the amount about to be proposed.
  const typedAmount = Number(amountText);
  const liveFits = (available: number) =>
    Number.isFinite(typedAmount) &&
    typedAmount > 0 &&
    available + 0.005 >= typedAmount;
  const liveRemaining = (available: number) =>
    Math.max(0, Math.round((available - typedAmount) * 100) / 100);

  const selected = options.find(
    (option) => option.option.allocationId === allocationId
  );

  // The dead end, named for what it actually is: no line covers the need on
  // its own, and either the pooled budgets still can (split the reservation)
  // or the money itself is finished (only adding budget helps). Both say the
  // way out instead of leaving the reader to invent one.
  const anyCovers = options.some((option) => option.covers);
  const totalAvailable = Math.round(
    options.reduce((sum, option) => sum + option.option.available, 0) * 100
  ) / 100;
  const pooledCovers = coversInTotal({
    shortfall: facts.uncommitted,
    allocations: options.map((option) => option.option),
  });
  const budgetShortHint =
    !anyCovers && pooledCovers
      ? t.splitHint.replaceAll("{total}", formatPeso(totalAvailable))
      : !anyCovers
        ? t.exhaustedHint
            .replaceAll("{total}", formatPeso(totalAvailable))
            .replaceAll("{need}", formatPeso(facts.uncommitted))
        : null;

  async function submit(formData: FormData) {
    setBusy(true);
    setError(null);

    const notes = String(formData.get("notes") ?? "");
    const response = await apiRequest<{
      earmarkId: number;
      code: string | null;
      amount: number;
    }>("/api/v1/treasury/earmarks", {
      method: "POST",
      body: JSON.stringify({
        allocationId: Number(formData.get("allocationId")),
        concernId: facts.concernId,
        purpose: String(formData.get("purpose") ?? ""),
        amount: Number(formData.get("amount")),
        notes: notes === "" ? null : notes,
      }),
    });

    setBusy(false);
    if (!response.success) {
      setError(response.error.message);
      return;
    }
    setResult(response.data);
    // Let the success panel be read before the refresh re-reads the queue:
    // the card then settles into its "waiting on the Captain" state, which is
    // the same fact in persistent form. The refresh is what keeps the queue
    // honest — without it this case still looks unfunded and invites a second
    // proposal of the same money.
    setTimeout(() => router.refresh(), 1500);
  }

  if (result !== null) {
    return (
      <div className="space-y-3 rounded-control border border-emerald-200 bg-emerald-50 px-4 py-3">
        <p className="text-sm font-semibold text-emerald-900">
          {t.successTitle.replaceAll("{code}", result.code ?? `#${result.earmarkId}`)}
        </p>
        <p className="text-sm text-emerald-800">
          {t.successLead
            .replaceAll("{amount}", formatPeso(result.amount))
            .replaceAll(
              "{allocation}",
              selected?.option.label ?? ""
            )
            .replaceAll("{case}", facts.caseNumber)}
        </p>
        <p className="text-sm text-emerald-800">{t.successQueue}</p>
        <div className="flex flex-wrap gap-2">
          <Button href="/treasury/earmarks" size="sm" variant="outline">
            {t.viewEarmark}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form action={submit} className="space-y-5">
      <RequiredLegend>{copy[locale].revamp.treasuryDesk.requiredLegend}</RequiredLegend>
      {error && <FormMessage tone="error">{error}</FormMessage>}

      {/* ── 1. What the case needs — stated, not looked up ── */}
      <fieldset className="space-y-2">
        <legend className="text-caption font-semibold uppercase tracking-wide text-ink-subtle">
          1. {t.stepNeed}
        </legend>
        <dl className="divide-y divide-line rounded-control border border-line bg-surface-sunken/60 px-3">
          <div className="flex items-baseline justify-between gap-3 py-1.5">
            <dt className="text-sm text-ink-muted">{t.caseEstimateLabel}</dt>
            <dd className="text-sm font-semibold tabular-nums text-ink">
              {facts.estimate === null ? "—" : formatPeso(facts.estimate)}
            </dd>
          </div>
          {facts.setAside > 0 && (
            <div className="flex items-baseline justify-between gap-3 py-1.5">
              <dt className="text-sm text-ink-muted">{t.setAsideLabel}</dt>
              <dd className="text-sm font-semibold tabular-nums text-ink">
                {formatPeso(facts.setAside)}
              </dd>
            </div>
          )}
          {facts.proposed > 0 && (
            <div className="flex items-baseline justify-between gap-3 py-1.5">
              <dt className="text-sm text-ink-muted">{t.pendingLabel}</dt>
              <dd className="text-sm font-semibold tabular-nums text-amber-700">
                {formatPeso(facts.proposed)}
              </dd>
            </div>
          )}
          <div className="flex items-baseline justify-between gap-3 py-1.5">
            <dt className="text-sm text-ink-muted">{t.stillNeededLabel}</dt>
            <dd className="text-sm font-semibold tabular-nums text-ink">
              {formatPeso(facts.uncommitted)}
            </dd>
          </div>
        </dl>
      </fieldset>

      {/* ── 2. Which budget pays — one recommendation, visible maths ── */}
      <fieldset className="space-y-2">
        <legend className="text-caption font-semibold uppercase tracking-wide text-ink-subtle">
          2. {t.stepBudget}
        </legend>
        {budgetShortHint && (
          <div className="space-y-2">
            <p className="rounded-control border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {budgetShortHint}
            </p>
            {canAddBudget && (
              <AddBudgetActions label={t.addBudget} howTo={t.addBudgetHow} />
            )}
          </div>
        )}
        <div className="space-y-2">
          {options.map((option) => {
            const id = `fund-allocation-${facts.concernId}-${option.option.allocationId}`;
            const checked = allocationId === option.option.allocationId;
            return (
              <label
                key={id}
                htmlFor={id}
                className={`flex cursor-pointer items-start gap-3 rounded-control border px-3 py-2.5 ${
                  checked
                    ? "border-brand-600 bg-brand-50/60"
                    : "border-line bg-surface hover:border-line-strong"
                }`}
              >
                <input
                  type="radio"
                  id={id}
                  name="allocationId"
                  value={option.option.allocationId}
                  checked={checked}
                  onChange={() => setAllocationId(option.option.allocationId)}
                  className="mt-1 h-4 w-4 shrink-0 accent-brand-700"
                />
                <span className="min-w-0 space-y-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-ink">
                      {option.option.label}
                    </span>
                    {option.recommended && (
                      <Badge tone="green">{t.recommended}</Badge>
                    )}
                  </span>
                  <span className="block text-xs text-ink-subtle">
                    {option.option.coaCode} — {option.option.coaName} ·{" "}
                    {option.option.fundSourceCode} · FY {option.option.fiscalYear}
                  </span>
                  <span className="block text-xs text-ink-muted">
                    {option.scope === "CASE_OFFICE" ? t.reasonOffice : null}
                    {option.scope === "BARANGAY_WIDE" ? t.reasonBarangayWide : null}
                    {option.scope === "OTHER_OFFICE" ? t.reasonOtherOffice : null}
                  </span>
                  {liveFits(option.option.available) ? (
                    <span className="flex items-center gap-1 text-xs font-medium text-emerald-700">
                      <Check size={14} aria-hidden="true" />
                      {t.coversDetail
                        .replaceAll("{available}", formatPeso(option.option.available))
                        .replaceAll(
                          "{remaining}",
                          formatPeso(liveRemaining(option.option.available))
                        )}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs font-medium text-amber-700">
                      <AlertTriangle size={14} aria-hidden="true" />
                      {t.notCovers
                        .replaceAll("{available}", formatPeso(option.option.available))
                        .replaceAll("{need}", formatPeso(facts.uncommitted))}
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* ── 3. The proposal — prefilled, one review and one click ── */}
      <fieldset className="space-y-3">
        <legend className="text-caption font-semibold uppercase tracking-wide text-ink-subtle">
          3. {t.stepPropose}
        </legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor={`fund-amount-${facts.concernId}`} required>
              {t.amountLabel}
            </Label>
            <Input
              id={`fund-amount-${facts.concernId}`}
              name="amount"
              type="number"
              min="0.01"
              step="0.01"
              required
              value={amountText}
              onChange={(event) => setAmountText(event.target.value)}
            />
            <FieldHint>
              {t.stillNeededLabel}: {formatPeso(facts.uncommitted)}
            </FieldHint>
          </div>
          <div>
            <Label htmlFor={`fund-purpose-${facts.concernId}`} required>
              {t.purposeLabel}
            </Label>
            <Input
              id={`fund-purpose-${facts.concernId}`}
              name="purpose"
              required
              maxLength={200}
              defaultValue={`${facts.caseNumber} — ${facts.title}`.slice(0, 200)}
            />
          </div>
        </div>
        <div>
          <Label htmlFor={`fund-notes-${facts.concernId}`}>
            {t.notesLabel}
          </Label>
          <Textarea
            id={`fund-notes-${facts.concernId}`}
            name="notes"
            rows={2}
            maxLength={500}
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={busy || allocationId === null}>
            {busy ? common.saving : t.submit}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
