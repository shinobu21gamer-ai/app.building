// Manpower and cost planning for a case under assessment.
//
// Pure arithmetic only: the assessment service feeds it the planned crew, the
// duration and the rates, and stores the frozen result on CaseAssessment.
// Labour is a first-class part of the estimate — a case whose cost ignores the
// people doing the work is not costed at all.

export const MIN_WORKERS_NEEDED = 1;
/** A case needing more than this many workers is almost certainly a typo. */
export const MAX_WORKERS_NEEDED = 100;
/** Ninety days of work: beyond that the case is a project, not a repair. */
export const MAX_DURATION_MINUTES = 60 * 24 * 90;

/** Working hours in a day used to convert a duration into labour days. */
export const HOURS_PER_WORK_DAY = 8;

export const DEFAULT_CURRENCY = "PHP";

/**
 * Rounds to centavos, the way a money column stores it.
 *
 * `value * 100` can land a hair below a half centavo (1.005 * 100 comes out as
 * 100.49999999999999), which would round a peso quantity down for no reason, so
 * the scaled number is re-read at six decimals before the half-up rounding.
 */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Number((value * 100).toFixed(6))) / 100;
}

/** True when the value is a usable integer head-count (>= 1). */
export function isValidWorkersNeeded(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_WORKERS_NEEDED &&
    value <= MAX_WORKERS_NEEDED
  );
}

/** True when the value is a usable duration in minutes. */
export function isValidDurationMinutes(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 15 &&
    value <= MAX_DURATION_MINUTES
  );
}

export type LaborBasis = {
  workers: number;
  durationMinutes: number;
  hours: number;
  days: number;
  hoursPerDay: number;
  hourlyRate: number | null;
  dailyRate: number | null;
  /** "hourly" | "daily" | "manual" — how the figure was produced. */
  /**
   * "hourly" | "daily" | "manual" | "no_crew" | "no_rate".
   * no_crew: nobody is assigned, so labour is zero. no_rate: crew are assigned but no rate
   * or figure exists, so labour is zero and the gap is recorded here.
   */
  computedFrom: "hourly" | "daily" | "manual" | "no_crew" | "no_rate";
  /** The assessor's own labour figure, kept so a later recount can reuse it. */
  manualFigure?: number | null;
  /** Sum of the crew members' own rates when they were used. */
  crewRatesUsed?: number;
};

export type LaborEstimate = {
  laborCost: number;
  basis: LaborBasis;
};

/**
 * Labour cost for a plan. When the crew roster knows an hourly rate that wins;
 * otherwise a daily rate is pro-rated by the working day. With neither rate the
 * caller must supply a manual figure (see `manualLaborEstimate`).
 */
export function estimateLaborCost(input: {
  workers: number;
  durationMinutes: number;
  hourlyRate?: number | null;
  dailyRate?: number | null;
  hoursPerDay?: number;
}): LaborEstimate | null {
  const { workers, durationMinutes } = input;
  if (!isValidWorkersNeeded(workers) || !isValidDurationMinutes(durationMinutes)) {
    return null;
  }

  const hoursPerDay = input.hoursPerDay ?? HOURS_PER_WORK_DAY;
  const hours = roundMoney(durationMinutes / 60);
  const days = roundMoney(hours / hoursPerDay);

  const hourlyRate =
    typeof input.hourlyRate === "number" && input.hourlyRate > 0
      ? input.hourlyRate
      : null;
  const dailyRate =
    typeof input.dailyRate === "number" && input.dailyRate > 0
      ? input.dailyRate
      : null;

  if (hourlyRate !== null) {
    return {
      laborCost: roundMoney(workers * hours * hourlyRate),
      basis: {
        workers,
        durationMinutes,
        hours,
        days,
        hoursPerDay,
        hourlyRate,
        dailyRate,
        computedFrom: "hourly",
      },
    };
  }

  if (dailyRate !== null) {
    return {
      laborCost: roundMoney(workers * days * dailyRate),
      basis: {
        workers,
        durationMinutes,
        hours,
        days,
        hoursPerDay,
        hourlyRate: null,
        dailyRate,
        computedFrom: "daily",
      },
    };
  }

  return null;
}

/** Labour figure typed in by the assessor when no rate is on file. */
export function manualLaborEstimate(input: {
  workers: number;
  durationMinutes: number;
  laborCost: number;
}): LaborEstimate {
  const hours = roundMoney(input.durationMinutes / 60);
  return {
    laborCost: roundMoney(input.laborCost),
    basis: {
      workers: input.workers,
      durationMinutes: input.durationMinutes,
      hours,
      days: roundMoney(hours / HOURS_PER_WORK_DAY),
      hoursPerDay: HOURS_PER_WORK_DAY,
      hourlyRate: null,
      dailyRate: null,
      computedFrom: "manual",
    },
  };
}

export type CostEstimate = {
  laborCost: number;
  materialsCost: number;
  equipmentCost: number;
  otherCost: number;
  totalCost: number;
};

/** Adds the four cost buckets. The total always includes labour. */
export function totalCostEstimate(parts: {
  laborCost: number;
  materialsCost?: number;
  equipmentCost?: number;
  otherCost?: number;
}): CostEstimate {
  const materialsCost = roundMoney(parts.materialsCost ?? 0);
  const equipmentCost = roundMoney(parts.equipmentCost ?? 0);
  const otherCost = roundMoney(parts.otherCost ?? 0);
  const laborCost = roundMoney(parts.laborCost);

  return {
    laborCost,
    materialsCost,
    equipmentCost,
    otherCost,
    totalCost: roundMoney(laborCost + materialsCost + equipmentCost + otherCost),
  };
}

/** "2 days 4 hours" — a duration an assessor can read at a glance. */
export function durationLabel(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const days = Math.floor(total / (60 * HOURS_PER_WORK_DAY));
  const hours = Math.floor((total - days * 60 * HOURS_PER_WORK_DAY) / 60);
  const rest = total % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days} day${days === 1 ? "" : "s"}`);
  if (hours > 0) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
  if (parts.length === 0 && rest > 0) parts.push(`${rest} min`);
  return parts.length > 0 ? parts.join(" ") : "0 min";
}

/** "₱1,234.50" for the UI. */
export function formatPeso(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const numeric = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(numeric)) return "—";
  return `₱${numeric.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Whether the planned crew covers the plan. `required` is null for a legacy
 * case that was never assessed — such a case is not gated.
 */
export function crewCoverage(input: {
  required: number | null;
  assigned: number;
}): {
  satisfied: boolean;
  shortfall: number;
  label: string;
} {
  if (input.required === null) {
    return {
      satisfied: true,
      shortfall: 0,
      label: `${input.assigned} assigned`,
    };
  }
  const shortfall = Math.max(0, input.required - input.assigned);
  return {
    satisfied: shortfall === 0,
    shortfall,
    label: `${input.assigned} of ${input.required} assigned`,
  };
}
