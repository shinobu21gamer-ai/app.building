import { db } from "@/lib/db";
import { FACTOR_KEYS, type FactorConfig, type ThresholdConfig } from "@/lib/priority/engine";

export async function loadPriorityConfig(): Promise<{
  factors: FactorConfig[];
  thresholds: ThresholdConfig[];
}> {
  const [factors, thresholds] = await Promise.all([
    db.priorityFactorConfig.findMany({ orderBy: { displayOrder: "asc" } }),
    db.priorityConfig.findMany({ orderBy: { minScore: "asc" } }),
  ]);

  return {
    factors: factors.map((f) => ({
      key: f.key,
      label: f.label,
      description: f.description,
      weight: f.weight,
      minScore: f.minScore,
      maxScore: f.maxScore,
      displayOrder: f.displayOrder,
      isActive: f.isActive,
    })),
    thresholds: thresholds.map((t) => ({
      level: t.level,
      minScore: t.minScore,
      maxScore: t.maxScore,
      label: t.label,
      isActive: t.isActive,
    })),
  };
}

export type PriorityConfigInput = {
  thresholds: {
    level: string;
    minScore: number;
    maxScore: number;
    label?: string | null;
  }[];
  factors: {
    key: string;
    label: string;
    description?: string | null;
    weight: number;
    minScore: number;
    maxScore: number;
    displayOrder?: number;
    isActive?: boolean;
  }[];
};

export async function savePriorityConfiguration(
  input: PriorityConfigInput
): Promise<void> {
  const knownKeys = new Set<string>(FACTOR_KEYS);
  const factorKeys = input.factors.map((f) => f.key);
  const thresholdLevels = input.thresholds.map((threshold) => threshold.level);

  await db.$transaction(async (tx) => {
    await tx.priorityConfig.updateMany({
      where: { level: { notIn: thresholdLevels } },
      data: { isActive: false },
    });

    for (const threshold of input.thresholds) {
      await tx.priorityConfig.upsert({
        where: { level: threshold.level },
        update: {
          minScore: threshold.minScore,
          maxScore: threshold.maxScore,
          label: threshold.label ?? null,
          isActive: true,
        },
        create: {
          level: threshold.level,
          minScore: threshold.minScore,
          maxScore: threshold.maxScore,
          label: threshold.label ?? null,
          isActive: true,
        },
      });
    }

    await tx.priorityFactorConfig.updateMany({
      where: { key: { notIn: factorKeys } },
      data: { isActive: false },
    });

    for (const [index, factor] of input.factors.entries()) {
      if (!knownKeys.has(factor.key)) continue;
      const data = {
        label: factor.label,
        description: factor.description ?? null,
        weight: factor.weight,
        minScore: factor.minScore,
        maxScore: factor.maxScore,
        displayOrder: factor.displayOrder ?? index + 1,
        isActive: factor.isActive ?? true,
      };
      await tx.priorityFactorConfig.upsert({
        where: { key: factor.key },
        update: data,
        create: { key: factor.key, ...data },
      });
    }
  });
}
