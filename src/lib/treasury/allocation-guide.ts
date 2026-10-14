// The guided "prepare an allocation" decision.
//
// Preparing an allocation used to be four accounting facts asked at once —
// fiscal year, fund source, COA account, office — in a form that explained
// none of them, and it answered a mistake only after the click, as a 409 that
// named the line the treasurer should have adjusted instead.
//
// This module holds the parts of that job that can be decided from facts
// alone, so the form can lead with them instead of asking:
//
//   * which fiscal year to suggest (the newest one still open) and what is
//     missing before a line can exist at all (an open year, a verified fund
//     source, a verified MOOE account);
//   * the exact label the register will store, so the reader sees the line
//     they are creating before they create it;
//   * whether the register already holds that line, so the duplicate is caught
//     where it can still be acted on (a link to adjust it) rather than as an
//     error after submitting;
//   * whether the amount typed is one the server will accept, so the refusal
//     arrives while the cursor is still in the field;
//   * the amount and office a case's funding panel prefills, so preparing the
//     budget a resident is waiting on starts from that case's own numbers.
//
// Pure: no database, no framework imports. Same split as `funding-guide.ts`:
// this file returns codes and numbers, the screens turn them into sentences
// through `copy`.

export type FiscalYearOption = { id: number; year: number; isClosed: boolean };

/** A verified fund source or COA account, as the pickers offer them. */
export type ReferenceOption = { id: number; code: string; name: string };

/**
 * One row of the appropriation register — as much of it as this module reads.
 * `AllocationRow` from `query.ts` satisfies it, so the page hands the register
 * over without a second query.
 */
export type RegisterLine = {
  id: number;
  label: string;
  status: string;
  fiscalYearId: number;
  fundSourceCode: string;
  coaCode: string;
  officeId: number | null;
};

export function openFiscalYears<T extends { isClosed: boolean }>(
  years: readonly T[]
): T[] {
  return years.filter((year) => !year.isClosed);
}

/**
 * The newest open fiscal year: new money belongs to the year being budgeted,
 * and a closed year cannot take an appropriation at all.
 */
export function recommendFiscalYear(
  years: readonly FiscalYearOption[]
): FiscalYearOption | null {
  const open = openFiscalYears(years);
  if (open.length === 0) return null;
  return open.reduce((newest, year) => (year.year > newest.year ? year : newest));
}

/**
 * The one option of a picker that has no decision in it. A single verified
 * fund source cannot be chosen wrongly, so the form may choose it for the
 * reader — unlike a list of two, where the choice is the accounting fact.
 */
export function onlyOptionId(
  options: readonly { id: number }[]
): number | null {
  return options.length === 1 ? options[0].id : null;
}

/** What is missing before an allocation can be prepared at all. */
export type AllocationBlocker =
  | "NO_OPEN_FISCAL_YEAR"
  | "NO_VERIFIED_FUND_SOURCE"
  | "NO_VERIFIED_COA_ACCOUNT";

export function allocationBlockers(input: {
  fiscalYears: readonly FiscalYearOption[];
  fundSources: readonly unknown[];
  coaAccounts: readonly unknown[];
}): AllocationBlocker[] {
  const blockers: AllocationBlocker[] = [];
  if (openFiscalYears(input.fiscalYears).length === 0) {
    blockers.push("NO_OPEN_FISCAL_YEAR");
  }
  if (input.fundSources.length === 0) {
    blockers.push("NO_VERIFIED_FUND_SOURCE");
  }
  if (input.coaAccounts.length === 0) {
    blockers.push("NO_VERIFIED_COA_ACCOUNT");
  }
  return blockers;
}

/**
 * The exact label the register will store for a line. The form sends this
 * string as `label`, so the preview a reader approves on screen is literally
 * the row they get — the two cannot drift.
 */
export function allocationLabel(input: {
  fiscalYear: number | null;
  fundSourceCode: string | null;
  coaCode: string | null;
  coaName: string | null;
  /** Null = barangay-wide, then `officeWideLabel` names it. */
  officeName: string | null;
  officeWideLabel: string;
}): string {
  return [
    input.fiscalYear === null ? null : `FY ${input.fiscalYear}`,
    input.fundSourceCode,
    input.coaCode,
    input.coaName,
    input.officeName ?? input.officeWideLabel,
  ]
    .map((part) => (part ?? "").trim())
    .filter((part) => part !== "")
    .join(" — ")
    .slice(0, 160);
}

/**
 * The line the register already holds for this exact combination.
 *
 * The database allows one allocation per fiscal year, fund source, COA account
 * and office; the service refuses a second one with a 409 that names the
 * existing line and tells the treasurer to adjust it. Finding it here moves
 * that refusal in front of the click, where a link to the line can replace a
 * dead end. Every status counts, because the service refuses regardless of
 * whether the existing line is a draft, approved or closed.
 */
export function findExistingAllocation(
  lines: readonly RegisterLine[],
  key: {
    fiscalYearId: number | null;
    fundSourceCode: string | null;
    coaCode: string | null;
    officeId: number | null;
  }
): RegisterLine | null {
  if (key.fiscalYearId === null || !key.fundSourceCode || !key.coaCode) {
    return null;
  }
  return (
    lines.find(
      (line) =>
        line.fiscalYearId === key.fiscalYearId &&
        line.fundSourceCode === key.fundSourceCode &&
        line.coaCode === key.coaCode &&
        line.officeId === key.officeId
    ) ?? null
  );
}

/** The largest appropriation the server accepts (see `amountSchema`). */
export const MAX_APPROPRIATION = 1_000_000_000;

export type AppropriationCheck =
  | "EMPTY"
  | "NOT_A_NUMBER"
  | "NOT_POSITIVE"
  | "TOO_LARGE"
  | "OK";

/**
 * Reads the amount field the way the server will, so the form can say what is
 * wrong while the reader is still typing it. Mirrors `amountSchema` in
 * `src/lib/validations/treasury.ts` — more than zero, at most one billion,
 * rounded to centavos.
 */
export function checkAppropriation(text: string): AppropriationCheck {
  const trimmed = text.trim();
  if (trimmed === "") return "EMPTY";
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return "NOT_A_NUMBER";
  if (value <= 0) return "NOT_POSITIVE";
  if (value > MAX_APPROPRIATION) return "TOO_LARGE";
  return "OK";
}

/** The amount, as the number to send — null when the field is not usable. */
export function appropriationValue(text: string): number | null {
  if (checkAppropriation(text) !== "OK") return null;
  return Math.round(Number(text.trim()) * 100) / 100;
}

/** What a link from a case's funding panel carries into the form. */
export type AllocationPrefill = {
  /** The amount the case is short of, ready in the amount field. */
  amount: number | null;
  /** The case's office, when that office exists. */
  officeId: number | null;
  /** The case the reader came from, named in the prefilled notice. */
  caseNumber: string | null;
  /** Its id, so the reader can go back to the funding desk when they are done. */
  concernId: number | null;
};

/**
 * Reads `?amount=`, `?office=` and `?case=` — the way `/treasury/fund`'s
 * "Add a budget" hands a case's shortfall over to this form.
 *
 * Only an office that exists is kept (a URL is user input, and an office id
 * from a stale link must not preselect a wrong line), and only a positive
 * amount is kept. Everything else falls back to an empty form, so a bad link
 * leaves the reader exactly where they would have been without it.
 */
export function allocationPrefill(
  params: { amount?: string; office?: string; case?: string; concern?: string },
  input: { officeIds: readonly number[] }
): AllocationPrefill {
  const amount = Number((params.amount ?? "").trim());
  const office = Number((params.office ?? "").trim());
  const caseNumber = (params.case ?? "").trim();
  const concern = Number((params.concern ?? "").trim());

  return {
    amount:
      (params.amount ?? "").trim() !== "" &&
      Number.isFinite(amount) &&
      amount > 0 &&
      amount <= MAX_APPROPRIATION
        ? Math.round(amount * 100) / 100
        : null,
    officeId:
      Number.isInteger(office) && input.officeIds.includes(office)
        ? office
        : null,
    caseNumber: caseNumber === "" ? null : caseNumber.slice(0, 40),
    concernId: Number.isInteger(concern) && concern > 0 ? concern : null,
  };
}

/** True when a prefill carries anything the reader should be told about. */
export function prefillIsEmpty(prefill: AllocationPrefill): boolean {
  return (
    prefill.amount === null &&
    prefill.officeId === null &&
    prefill.caseNumber === null &&
    prefill.concernId === null
  );
}
