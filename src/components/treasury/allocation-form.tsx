"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { StepGuide } from "@/components/cases/step-guide";
import {
  FieldError,
  FieldHint,
  FormMessage,
  Input,
  Label,
  RequiredLegend,
  Select,
  Textarea,
} from "@/components/ui/field";
import { apiRequest } from "@/lib/api-client";
import { formatPeso } from "@/lib/cases/manpower";
import { copy, type Locale } from "@/lib/i18n";
import {
  allocationLabel,
  appropriationValue,
  checkAppropriation,
  findExistingAllocation,
  onlyOptionId,
  openFiscalYears,
  recommendFiscalYear,
  type AllocationPrefill,
  type RegisterLine,
} from "@/lib/treasury/allocation-guide";
import {
  amountFitDelta,
  classifyAmountFit,
} from "@/lib/treasury/funding-guide";

export type ReferenceOption = {
  id: number;
  code: string;
  name: string;
};

const NO_PREFILL: AllocationPrefill = {
  amount: null,
  officeId: null,
  caseNumber: null,
  concernId: null,
};

/** The numbered heading of one decision, styled like `StepGuide`. */
function StepHeading({
  step,
  title,
  detail,
}: {
  step: number;
  title: string;
  detail: string;
}) {
  return (
    <div className="flex gap-3">
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-brand-600 bg-brand-600 text-xs font-semibold text-white"
      >
        {step}
      </span>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-subtle">
          {detail}
        </p>
      </div>
    </div>
  );
}

/** One labelled row of the "line you are about to prepare" panel. */
function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-32 shrink-0 text-xs text-ink-subtle">{label}</dt>
      <dd className="min-w-0 text-sm text-ink-muted">{value}</dd>
    </div>
  );
}

/**
 * Prepares an appropriation — the guided way.
 *
 * The job is four accounting facts (fiscal year, fund source, COA account,
 * office) plus an amount. The form used to ask for all five at once without
 * saying what any of them were for, and the most common mistake — a line that
 * already exists for that combination — came back as an error after the click.
 *
 * So the form now asks three questions in order, each with one line of plain
 * language under it:
 *
 *   1. what the money is for        — the COA account, the spending category;
 *   2. where the money comes from   — the fund source and the fiscal year;
 *   3. how much, and who may spend it — the amount, and the office or
 *      barangay-wide scope.
 *
 * and it answers the two questions a treasurer has while filling it in, not
 * after submitting:
 *
 *   * "what am I creating?" — the summary panel states the line in words,
 *     with the exact label the register will store (`allocationLabel` is the
 *     string the form sends, so the preview cannot drift from the row);
 *   * "is this one we already have?" — the duplicate key (year + fund source
 *     + COA account + office) is checked against the register as the choices
 *     are made, and the existing line is offered as a link to adjust, because
 *     the server refuses a second one.
 *
 * Only verified fund sources and verified MOOE accounts are offered: the API
 * rejects the rest anyway, and a picker that cannot produce a refusal is
 * easier to trust than a warning that says so.
 */
export function AllocationForm({
  fiscalYears,
  fundSources,
  coaAccounts,
  offices,
  register = [],
  prefill = null,
  canOpenFiscalYear = false,
  locale = "en",
}: {
  fiscalYears: Array<{ id: number; year: number; isClosed: boolean }>;
  fundSources: ReferenceOption[];
  coaAccounts: ReferenceOption[];
  offices: Array<{ id: number; name: string }>;
  /** The appropriation register, so a duplicate is caught before submitting. */
  register?: RegisterLine[];
  /** The amount and office handed over by a case's funding panel. */
  prefill?: AllocationPrefill | null;
  canOpenFiscalYear?: boolean;
  locale?: Locale;
}) {
  const t = copy[locale].revamp.treasuryDesk;
  const g = t.allocationGuide;
  const common = copy[locale].revamp.common;
  const router = useRouter();

  const startingPrefill = prefill ?? NO_PREFILL;
  const openYears = openFiscalYears(fiscalYears);
  const recommendedYear = recommendFiscalYear(fiscalYears);
  const singleFundSourceId = onlyOptionId(fundSources);

  const [open, setOpen] = useState(
    startingPrefill.amount !== null || startingPrefill.caseNumber !== null
  );
  const [fiscalYearId, setFiscalYearId] = useState<number>(
    recommendedYear?.id ?? 0
  );
  const [fundSourceId, setFundSourceId] = useState<number>(
    singleFundSourceId ?? 0
  );
  const [coaAccountId, setCoaAccountId] = useState<number>(0);
  const [officeId, setOfficeId] = useState<number | null>(
    startingPrefill.officeId
  );
  const [amount, setAmount] = useState<string>(
    startingPrefill.amount === null ? "" : startingPrefill.amount.toFixed(2)
  );
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{
    id: number;
    amount: number;
  } | null>(null);

  const chosenYear =
    openYears.find((year) => year.id === fiscalYearId) ?? null;
  const chosenFundSource =
    fundSources.find((source) => source.id === fundSourceId) ?? null;
  const chosenCoa =
    coaAccounts.find((account) => account.id === coaAccountId) ?? null;
  const chosenOffice = offices.find((office) => office.id === officeId) ?? null;

  /** The exact string the register will store — see `allocationLabel`. */
  const labelPreview = allocationLabel({
    fiscalYear: chosenYear?.year ?? null,
    fundSourceCode: chosenFundSource?.code ?? null,
    coaCode: chosenCoa?.code ?? null,
    coaName: chosenCoa?.name ?? null,
    officeName: chosenOffice?.name ?? null,
    officeWideLabel: t.officeWideWard,
  });

  const duplicate = findExistingAllocation(register, {
    fiscalYearId: chosenYear?.id ?? null,
    fundSourceCode: chosenFundSource?.code ?? null,
    coaCode: chosenCoa?.code ?? null,
    officeId,
  });

  const amountCheck = checkAppropriation(amount);
  const amountError =
    amountCheck === "TOO_LARGE"
      ? g.amountTooLarge
      : amountCheck === "NOT_POSITIVE" || amountCheck === "NOT_A_NUMBER"
        ? g.amountNotPositive
        : null;

  const caseNeed = startingPrefill.amount;
  const caseNumber = startingPrefill.caseNumber;
  const typedAppropriation = Number(amount);
  const caseFit =
    caseNeed !== null
      ? classifyAmountFit(typedAppropriation, caseNeed)
      : null;
  const caseGap =
    caseNeed !== null ? amountFitDelta(typedAppropriation, caseNeed) : 0;
  const caseFitHint =
    caseNeed === null || caseNumber === null
      ? null
      : caseFit === "exact"
        ? g.amountFitExactOrdinance.replaceAll("{need}", formatPeso(caseNeed))
        : caseFit === "partial"
          ? g.amountFitPartialOrdinance
              .replaceAll("{short}", formatPeso(caseGap))
              .replaceAll("{need}", formatPeso(caseNeed))
          : caseFit === "over"
            ? g.amountFitOverOrdinance
                .replaceAll("{extra}", formatPeso(caseGap))
                .replaceAll("{need}", formatPeso(caseNeed))
            : g.amountVsCaseNeed
                .replaceAll("{case}", caseNumber)
                .replaceAll("{need}", formatPeso(caseNeed));

  const canSubmit =
    chosenYear !== null &&
    chosenFundSource !== null &&
    chosenCoa !== null &&
    amountCheck === "OK" &&
    duplicate === null &&
    !busy;

  async function submit() {
    setBusy(true);
    setError(null);

    const value = appropriationValue(amount);
    if (value === null || duplicate !== null) {
      // The button is disabled in both cases: this is the guard for a form
      // submitted with Enter before the state settled.
      setBusy(false);
      return;
    }

    const result = await apiRequest<{
      allocationId: number;
      appropriation: number;
    }>("/api/v1/treasury/allocations", {
      method: "POST",
      body: JSON.stringify({
        fiscalYearId: chosenYear?.id ?? 0,
        fundSourceId: chosenFundSource?.id ?? 0,
        coaAccountId: chosenCoa?.id ?? 0,
        officeId,
        label: labelPreview,
        appropriation: value,
        notes: notes.trim() === "" ? null : notes.trim(),
      }),
    });

    setBusy(false);
    if (!result.success) {
      setError(result.error.message);
      return;
    }
    setCreated({ id: result.data.allocationId, amount: value });
    setOpen(false);
    router.refresh();
  }

  /** Keeps the year, fund and office — the next line is usually a sibling. */
  function prepareAnother() {
    setCreated(null);
    setCoaAccountId(0);
    setAmount("");
    setNotes("");
    setOpen(true);
  }

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

  if (created !== null) {
    return (
      <div className="space-y-3">
        <FormMessage tone="success">
          {g.createdTitle} · {formatPeso(created.amount)}
        </FormMessage>
        <p className="text-sm leading-relaxed text-ink-muted">
          {g.createdBody}
        </p>
        {startingPrefill.concernId !== null && (
          <p className="text-sm leading-relaxed text-ink-muted">
            {g.backToFunding}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button href={`/treasury/budgets/${created.id}`} size="sm">
            {g.openAllocation}
          </Button>
          {startingPrefill.concernId !== null && (
            <Button
              href={`/treasury/fund?concernId=${startingPrefill.concernId}`}
              size="sm"
              variant="outline"
            >
              {g.backToFundingAction}
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={prepareAnother}
          >
            {g.prepareAnother}
          </Button>
        </div>
      </div>
    );
  }

  if (!open) {
    return (
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-ink-muted">{g.lead}</p>
        <StepGuide steps={g.steps} />
        <Button type="button" onClick={() => setOpen(true)}>
          {t.createAllocation}
        </Button>
      </div>
    );
  }

  return (
    <form action={submit} className="space-y-6">
      <RequiredLegend>{t.requiredLegend}</RequiredLegend>

      {error && <FormMessage tone="error">{error}</FormMessage>}

      {startingPrefill.caseNumber !== null && (
        <div className="rounded-control border border-brand-100 bg-brand-50 px-3 py-2.5">
          <p className="text-sm font-semibold text-brand-800">
            {g.prefilledTitle.replaceAll(
              "{case}",
              startingPrefill.caseNumber
            )}
          </p>
          {startingPrefill.amount !== null && (
            <p className="mt-1 text-xs leading-relaxed text-brand-800">
              {g.prefilledBody.replaceAll(
                "{amount}",
                formatPeso(startingPrefill.amount)
              )}
            </p>
          )}
        </div>
      )}

      <div className="space-y-3">
        <StepHeading
          step={1}
          title={g.stepWhatTitle}
          detail={g.stepWhatDetail}
        />
        <div>
          <Label htmlFor="allocation-coa" required>
            {t.coaAccount}
          </Label>
          <Select
            id="allocation-coa"
            name="coaAccountId"
            required
            value={coaAccountId === 0 ? "" : String(coaAccountId)}
            onChange={(event) =>
              setCoaAccountId(Number(event.target.value) || 0)
            }
          >
            <option value="">{t.selectCoaAccount}</option>
            {coaAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.code} — {account.name}
              </option>
            ))}
          </Select>
          <FieldHint>{t.verifiedCoaAccountHelp}</FieldHint>
        </div>
      </div>

      <div className="space-y-3">
        <StepHeading
          step={2}
          title={g.stepWhereTitle}
          detail={g.stepWhereDetail}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="allocation-fund-source" required>
              {t.fundSource}
            </Label>
            <Select
              id="allocation-fund-source"
              name="fundSourceId"
              required
              value={fundSourceId === 0 ? "" : String(fundSourceId)}
              onChange={(event) =>
                setFundSourceId(Number(event.target.value) || 0)
              }
            >
              <option value="">{t.selectFundSource}</option>
              {fundSources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.code} — {source.name}
                </option>
              ))}
            </Select>
            <FieldHint>
              {fundSources.length === 1
                ? g.singleFundSourceHelp
                : t.verifiedFundSourceHelp}
            </FieldHint>
          </div>
          <div>
            <Label htmlFor="allocation-fiscal-year" required>
              {t.fiscalYear}
            </Label>
            <Select
              id="allocation-fiscal-year"
              name="fiscalYearId"
              required
              value={fiscalYearId === 0 ? "" : String(fiscalYearId)}
              onChange={(event) =>
                setFiscalYearId(Number(event.target.value) || 0)
              }
            >
              {openYears.map((year) => (
                <option key={year.id} value={year.id}>
                  {year.year}
                  {year.id === recommendedYear?.id && ` (${t.recommended})`}
                </option>
              ))}
            </Select>
            <FieldHint>{g.fiscalYearHelp}</FieldHint>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <StepHeading
          step={3}
          title={g.stepHowMuchTitle}
          detail={g.stepHowMuchDetail}
        />
        <div className="grid gap-4 sm:grid-cols-2">
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
              inputMode="decimal"
              placeholder={g.amountExample}
              required
              value={amount}
              invalid={amountError !== null}
              aria-describedby={amountError !== null ? "allocation-appropriation-error" : "allocation-appropriation-hint"}
              onChange={(event) => setAmount(event.target.value)}
            />
            {amountError ? (
              <FieldError id="allocation-appropriation-error">{amountError}</FieldError>
            ) : (
              <FieldHint id="allocation-appropriation-hint">
                {t.appropriationHelp}
                {caseFitHint ? ` ${caseFitHint}` : ""}
              </FieldHint>
            )}
          </div>
          <div>
            <Label htmlFor="allocation-office">{t.office}</Label>
            <Select
              id="allocation-office"
              name="officeId"
              value={officeId === null ? "" : String(officeId)}
              onChange={(event) =>
                setOfficeId(
                  event.target.value === "" ? null : Number(event.target.value)
                )
              }
            >
              <option value="">{t.officeWideWard}</option>
              {offices.map((office) => (
                <option key={office.id} value={office.id}>
                  {office.name}
                </option>
              ))}
            </Select>
            <FieldHint>
              {officeId === null ? g.officeWideHelp : g.officeHelp}
            </FieldHint>
          </div>
        </div>
      </div>

      <div className="space-y-3 rounded-control border border-line bg-surface-sunken px-4 py-3.5">
        <h3 className="text-sm font-semibold text-ink">{g.summaryTitle}</h3>
        <dl className="space-y-1.5">
          <SummaryRow
            label={g.summaryFor}
            value={
              chosenCoa
                ? `${chosenCoa.name} (${chosenCoa.code})`
                : g.summaryNotChosen
            }
          />
          <SummaryRow
            label={g.summaryFrom}
            value={
              chosenFundSource
                ? `${chosenFundSource.name} (${chosenFundSource.code})`
                : g.summaryNotChosen
            }
          />
          <SummaryRow
            label={g.summaryYear}
            value={chosenYear ? String(chosenYear.year) : g.summaryNotChosen}
          />
          <SummaryRow
            label={g.summaryOffice}
            value={chosenOffice?.name ?? t.officeWideWard}
          />
          <SummaryRow
            label={g.summaryAmount}
            value={
              amountCheck === "OK"
                ? formatPeso(Number(amount))
                : g.summaryAmountHint
            }
          />
        </dl>
        {/* The label is only worth showing once the three choices that form it
            are made: a half-built label reads like a line that exists. */}
        {chosenYear !== null &&
          chosenFundSource !== null &&
          chosenCoa !== null && (
            <p className="text-xs leading-relaxed text-ink-subtle">
              {g.summarySavedAs}:{" "}
              <span className="font-medium text-ink-muted">{labelPreview}</span>
            </p>
          )}
        <p className="text-xs leading-relaxed text-ink-subtle">
          {g.summaryNext}
        </p>
      </div>

      {duplicate !== null && (
        <div className="space-y-2 rounded-control border border-amber-200 bg-amber-50 px-3 py-2.5">
          <p className="text-sm font-semibold text-amber-900">
            {g.duplicateTitle}
          </p>
          <p className="text-sm leading-relaxed text-amber-800">
            {g.duplicateLead
              .replaceAll("{label}", duplicate.label)
              .replaceAll("{id}", String(duplicate.id))
              .replaceAll("{status}", duplicate.status)}
          </p>
          <Button
            href={`/treasury/budgets/${duplicate.id}`}
            size="sm"
            variant="outline"
          >
            {g.duplicateOpen}
          </Button>
        </div>
      )}

      <div>
        <Label htmlFor="allocation-notes">{t.verificationNotes}</Label>
        <Textarea
          id="allocation-notes"
          name="notes"
          rows={2}
          maxLength={500}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={!canSubmit} loading={busy}>
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
