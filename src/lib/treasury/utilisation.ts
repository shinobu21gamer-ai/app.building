import { roundMoney } from "@/lib/treasury/ledger";

/**
 * Utilisation: how much of a MOOE allocation has actually been disbursed.
 *
 * The treasury dashboard's four headline figures and the treasury report's
 * utilisation table are the same arithmetic, so it lives here rather than in
 * either surface. The input is structural — anything with these fields (an
 * `AllocationRow`, and any future lighter projection) can be passed in.
 */

export type UtilisableAllocation = {
  id: number;
  label: string;
  status: string;
  coaCode: string;
  coaName: string;
  appropriation: number;
  reserved: number;
  disbursed: number;
  available: number;
};

export type UtilisationTotals = {
  appropriated: number;
  reserved: number;
  disbursed: number;
  available: number;
  allocations: number;
  utilisation: number | null;
};

export type UtilisationRow = {
  id: number;
  label: string;
  status: string;
  coaCode: string;
  coaName: string;
  appropriation: number;
  reserved: number;
  disbursed: number;
  available: number;
  utilisation: number | null;
};

/** Disbursed as a share of the appropriation, to one decimal. */
export function utilisationOf(
  appropriation: number,
  disbursed: number
): number | null {
  if (appropriation <= 0) return null;
  return Math.round((disbursed / appropriation) * 1000) / 10;
}

/** Closed allocations are historical: they are outside the live figures. */
export function liveAllocations<T extends { status: string }>(
  allocations: readonly T[]
): T[] {
  return allocations.filter((allocation) => allocation.status !== "CLOSED");
}

/**
 * The utilisation table's rows and the totals above them, from the same pass —
 * so a dashboard total and a report total cannot drift apart.
 */
export function summarizeUtilisation(
  allocations: readonly UtilisableAllocation[]
): { totals: UtilisationTotals; rows: UtilisationRow[] } {
  const rows = allocations.map((allocation) => ({
    id: allocation.id,
    label: allocation.label,
    status: allocation.status,
    coaCode: allocation.coaCode,
    coaName: allocation.coaName,
    appropriation: allocation.appropriation,
    reserved: allocation.reserved,
    disbursed: allocation.disbursed,
    available: allocation.available,
    utilisation: utilisationOf(allocation.appropriation, allocation.disbursed),
  }));

  const totals = liveAllocations(rows).reduce<UtilisationTotals>(
    (acc, row) => ({
      appropriated: roundMoney(acc.appropriated + row.appropriation),
      reserved: roundMoney(acc.reserved + row.reserved),
      disbursed: roundMoney(acc.disbursed + row.disbursed),
      available: roundMoney(acc.available + row.available),
      allocations: acc.allocations + 1,
      utilisation: null,
    }),
    {
      appropriated: 0,
      reserved: 0,
      disbursed: 0,
      available: 0,
      allocations: 0,
      utilisation: null,
    }
  );

  return {
    rows: rows.sort(
      (a, b) =>
        b.appropriation - a.appropriation || a.label.localeCompare(b.label)
    ),
    totals: {
      ...totals,
      utilisation: utilisationOf(totals.appropriated, totals.disbursed),
    },
  };
}
