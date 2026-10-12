import type { Prisma } from "@prisma/client";
import {
  estimateLaborCost,
  manualLaborEstimate,
  totalCostEstimate,
  type CostEstimate,
  type LaborBasis,
} from "@/lib/cases/manpower";

type Tx = Prisma.TransactionClient;

// Labour is paid only for crew who are actually on the case. "No crew, no
// payment": with nobody assigned, labour is zero, whatever the roster rates are.
// The estimate is recounted every time crew are assigned or released, so the
// funding gate always checks against the labour the case really has.

export type RateSet = { hourlyRate: number | null; dailyRate: number | null };

function positive(value: number | null | undefined): number | null {
  return typeof value === "number" && value > 0 ? value : null;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Average of the rates on file in an office. Used only for a person with no rate of their own. */
export function averageRates(rows: { hourlyRate: unknown; dailyRate: unknown }[]): RateSet | null {
  const hourly = rows.map((row) => num(row.hourlyRate)).filter((v): v is number => v !== null);
  const daily = rows.map((row) => num(row.dailyRate)).filter((v): v is number => v !== null);
  if (hourly.length === 0 && daily.length === 0) return null;
  const avg = (values: number[]) =>
    values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length;
  return { hourlyRate: avg(hourly), dailyRate: avg(daily) };
}

/**
 * Labour for the crew on the case. Each person is priced at their own rate, or the
 * office average when they have none. If nobody can be priced, the assessor's
 * manual figure is used for the crew as a group. With no crew, the answer is zero.
 */
export function crewLabour(input: {
  crew: RateSet[];
  durationMinutes: number;
  fallback: RateSet | null;
  manualFigure: number | null;
}): { cost: number; basis: LaborBasis } {
  const { crew, durationMinutes, fallback, manualFigure } = input;
  const shape = manualLaborEstimate({ workers: crew.length, durationMinutes, laborCost: 0 }).basis;
  // Kept in every basis, even when it is not used now, so a later recount can still apply it.
  const keptFigure = manualFigure !== null && manualFigure > 0 ? manualFigure : null;

  if (crew.length === 0) {
    return {
      cost: 0,
      basis: { ...shape, workers: 0, computedFrom: "no_crew", crewRatesUsed: 0, manualFigure: keptFigure },
    };
  }

  let cost = 0;
  let priced = 0;
  let usedHourly = false;
  for (const person of crew) {
    const hourlyRate = positive(person.hourlyRate) ?? positive(fallback?.hourlyRate);
    const dailyRate = positive(person.dailyRate) ?? positive(fallback?.dailyRate);
    const estimate = estimateLaborCost({ workers: 1, durationMinutes, hourlyRate, dailyRate });
    if (!estimate) continue;
    cost += estimate.laborCost;
    priced += 1;
    if (estimate.basis.computedFrom === "hourly") usedHourly = true;
  }

  if (priced > 0) {
    return {
      cost: Math.round(cost * 100) / 100,
      basis: {
        ...shape,
        workers: crew.length,
        hourlyRate: null,
        dailyRate: null,
        computedFrom: usedHourly ? "hourly" : "daily",
        crewRatesUsed: priced,
        manualFigure: keptFigure,
      },
    };
  }

  if (manualFigure !== null && manualFigure > 0) {
    const manual = manualLaborEstimate({ workers: crew.length, durationMinutes, laborCost: manualFigure });
    return { cost: manual.laborCost, basis: { ...manual.basis, manualFigure: keptFigure } };
  }

  return {
    cost: 0,
    basis: { ...shape, workers: crew.length, computedFrom: "no_rate", crewRatesUsed: 0, manualFigure: keptFigure },
  };
}

function previousManualFigure(json: string | null | undefined): number | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as { manualFigure?: unknown };
    return typeof parsed.manualFigure === "number" && parsed.manualFigure > 0 ? parsed.manualFigure : null;
  } catch {
    return null;
  }
}

/**
 * Recounts the labour and total on a case's assessment from the crew who are
 * active on it right now. Call this after any change to the crew, and after the
 * assessment is saved. Returns null when the case has no assessment yet.
 */
export async function refreshCaseLabour(
  tx: Tx,
  concernId: number,
  options: { manualFigure?: number | null } = {}
): Promise<{ cost: CostEstimate; basis: LaborBasis } | null> {
  const assessment = await tx.caseAssessment.findUnique({
    where: { concernId },
    select: {
      id: true,
      estimatedDurationMinutes: true,
      materialsCost: true,
      equipmentCost: true,
      otherCost: true,
      laborCostBasisJson: true,
    },
  });
  if (!assessment) return null;

  const concern = await tx.concern.findUnique({
    where: { id: concernId },
    select: { assignedOfficeId: true },
  });
  const officeId = concern?.assignedOfficeId ?? null;

  const active = await tx.crewAssignment.findMany({
    where: { concernId, isActive: true },
    select: {
      crew: { select: { crewProfile: { select: { hourlyRate: true, dailyRate: true } } } },
    },
  });
  const crew: RateSet[] = active.map((row) => ({
    hourlyRate: num(row.crew.crewProfile?.hourlyRate),
    dailyRate: num(row.crew.crewProfile?.dailyRate),
  }));

  const rated = await tx.crewProfile.findMany({
    where: {
      isActive: true,
      user: { isActive: true },
      ...(officeId ? { officeId } : {}),
      OR: [{ hourlyRate: { not: null } }, { dailyRate: { not: null } }],
    },
    select: { hourlyRate: true, dailyRate: true },
    take: 50,
  });
  const fallback = averageRates(rated);

  const manualFigure =
    options.manualFigure !== undefined
      ? options.manualFigure
      : previousManualFigure(assessment.laborCostBasisJson);

  const labour = crewLabour({
    crew,
    durationMinutes: assessment.estimatedDurationMinutes ?? 0,
    fallback,
    manualFigure,
  });

  const cost = totalCostEstimate({
    laborCost: labour.cost,
    materialsCost: Number(assessment.materialsCost ?? 0),
    equipmentCost: Number(assessment.equipmentCost ?? 0),
    otherCost: Number(assessment.otherCost ?? 0),
  });

  await tx.caseAssessment.update({
    where: { id: assessment.id },
    data: {
      laborCost: cost.laborCost,
      totalCost: cost.totalCost,
      laborCostBasisJson: JSON.stringify(labour.basis),
    },
  });

  return { cost, basis: labour.basis };
}

/** Why work cannot start while labour is unpriced. Null when labour is priced, or nobody is assigned. */
export function labourStartMessage(computedFrom: string | null | undefined): string | null {
  if (computedFrom !== "no_rate") return null;
  return (
    "Labour for the assigned crew cannot be priced yet: none of them has a rate on file, " +
    "and no labour figure is entered. Enter a labour figure on the assessment, or set the crew " +
    "member's rate, before work starts. Starting without it would understate the cost."
  );
}

/** Reads the stored basis (kept current by every crew change and assessment save) and returns the start block, if any. */
export async function labourStartBlock(tx: Tx, concernId: number): Promise<string | null> {
  const row = await tx.caseAssessment.findUnique({
    where: { concernId },
    select: { laborCostBasisJson: true },
  });
  if (!row?.laborCostBasisJson) return null;
  try {
    const parsed = JSON.parse(row.laborCostBasisJson) as { computedFrom?: string };
    return labourStartMessage(parsed.computedFrom);
  } catch {
    return null;
  }
}
