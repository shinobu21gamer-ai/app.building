export const FACTOR_KEYS = [
  "URGENCY",
  "IMPACT",
  "AFFECTED_POPULATION",
  "SAFETY",
] as const;

export type FactorKey = (typeof FACTOR_KEYS)[number];

export const FACTOR_KEY_TO_COLUMN = {
  URGENCY: "urgencyScore",
  IMPACT: "impactScore",
  AFFECTED_POPULATION: "affectedPopulationScore",
  SAFETY: "safetyScore",
} as const;

export type FactorScoreInput = {
  urgencyScore: number;
  impactScore: number;
  affectedPopulationScore: number;
  safetyScore: number;
};

export type FactorConfig = {
  key: string;
  label: string;
  description?: string | null;
  weight: number;
  minScore: number;
  maxScore: number;
  displayOrder: number;
  isActive?: boolean;
};

export type ThresholdConfig = {
  level: string;
  minScore: number;
  maxScore: number;
  label?: string | null;
  isActive?: boolean;
};

export type PriorityBreakdownItem = {
  key: string;
  label: string;
  score: number;
  weight: number;
  weightedScore: number;
  minScore: number;
  maxScore: number;
};

export type PriorityEvaluation = {
  totalScore: number;
  level: string;
  minPossible: number;
  maxPossible: number;
  factors: PriorityBreakdownItem[];
  matchedThreshold: {
    level: string;
    minScore: number;
    maxScore: number;
  } | null;
  weights: Record<string, number>;
  explanation: string[];
};

/**
 * Thrown when the rule engine is given invalid scores or misconfigured rules.
 * Pure and framework-free so the engine can be unit tested in isolation.
 */
export class PriorityRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PriorityRuleError";
  }
}

/**
 * Resolves the priority level for a total score using the configured
 * thresholds. Prefers an exact range match, then falls back to the highest
 * threshold whose lower bound is not above the score.
 */
export function resolveThreshold(
  total: number,
  thresholds: ThresholdConfig[]
): ThresholdConfig | null {
  const sorted = [...thresholds].sort(
    (a, b) => a.minScore - b.minScore || a.maxScore - b.maxScore
  );

  const exact = sorted.find(
    (t) => total >= t.minScore && total <= t.maxScore
  );
  if (exact) return exact;

  let candidate: ThresholdConfig | null = null;
  for (const t of sorted) {
    if (total >= t.minScore) candidate = t;
  }
  return candidate;
}

/**
 * Transparent rule-based scoring engine. Not machine learning: the total is a
 * weighted sum of a small, fixed set of human-rated factors, and the level is
 * selected from administrator-configured score thresholds.
 */
export function evaluatePriority(
  scores: Partial<FactorScoreInput>,
  factors: FactorConfig[],
  thresholds: ThresholdConfig[]
): PriorityEvaluation {
  const activeFactors = factors
    .filter((f) => f.isActive !== false)
    .sort(
      (a, b) => a.displayOrder - b.displayOrder || a.key.localeCompare(b.key)
    );

  if (activeFactors.length === 0) {
    throw new PriorityRuleError("No active priority factors are configured.");
  }
  const activeThresholds = thresholds.filter((t) => t.isActive !== false);
  if (activeThresholds.length === 0) {
    throw new PriorityRuleError("No priority thresholds are configured.");
  }

  for (const factor of activeFactors) {
    if (!Number.isInteger(factor.weight) || factor.weight < 1) {
      throw new PriorityRuleError(
        `Factor "${factor.label}" has an invalid weight. Weights must be positive whole numbers.`
      );
    }
    if (
      !Number.isInteger(factor.minScore) ||
      !Number.isInteger(factor.maxScore) ||
      factor.minScore > factor.maxScore
    ) {
      throw new PriorityRuleError(
        `Factor "${factor.label}" has an invalid score range.`
      );
    }
  }

  const problems: string[] = [];
  const items: PriorityBreakdownItem[] = [];
  let totalScore = 0;
  let minPossible = 0;
  let maxPossible = 0;

  for (const factor of activeFactors) {
    const column = FACTOR_KEY_TO_COLUMN[factor.key as FactorKey];
    const raw = column ? scores[column] : undefined;

    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      problems.push(`${factor.label} is required.`);
      continue;
    }
    if (!Number.isInteger(raw)) {
      problems.push(`${factor.label} must be a whole number.`);
      continue;
    }
    if (raw < factor.minScore || raw > factor.maxScore) {
      problems.push(
        `${factor.label} must be between ${factor.minScore} and ${factor.maxScore}.`
      );
      continue;
    }

    const weightedScore = raw * factor.weight;
    items.push({
      key: factor.key,
      label: factor.label,
      score: raw,
      weight: factor.weight,
      weightedScore,
      minScore: factor.minScore,
      maxScore: factor.maxScore,
    });
    totalScore += weightedScore;
    minPossible += factor.minScore * factor.weight;
    maxPossible += factor.maxScore * factor.weight;
  }

  if (problems.length > 0) {
    throw new PriorityRuleError(problems.join(" "));
  }

  const matched = resolveThreshold(totalScore, activeThresholds);
  if (!matched) {
    throw new PriorityRuleError(
      `No priority threshold matches a total score of ${totalScore}.`
    );
  }

  const weights: Record<string, number> = {};
  for (const factor of activeFactors) weights[factor.key] = factor.weight;

  const explanation = [
    ...items.map((item) =>
      item.weight === 1
        ? `${item.label}: ${item.score}`
        : `${item.label}: ${item.score} × ${item.weight} = ${item.weightedScore}`
    ),
    `Total score: ${totalScore}`,
    `Priority level: ${matched.level} (${matched.minScore}–${matched.maxScore})`,
  ];

  return {
    totalScore,
    level: matched.level,
    minPossible,
    maxPossible,
    factors: items,
    matchedThreshold: {
      level: matched.level,
      minScore: matched.minScore,
      maxScore: matched.maxScore,
    },
    weights,
    explanation,
  };
}

/**
 * Validates a candidate priority configuration. Returns a list of
 * human-readable problems (empty when valid). Thresholds must form a
 * contiguous range covering every score the active factors can produce.
 */
export function validatePriorityConfiguration(
  factors: FactorConfig[],
  thresholds: ThresholdConfig[]
): string[] {
  const errors: string[] = [];

  const activeFactors = factors.filter((f) => f.isActive !== false);
  if (activeFactors.length === 0) {
    errors.push("At least one active priority factor is required.");
  }

  for (const factor of activeFactors) {
    if (!Number.isInteger(factor.weight) || factor.weight < 1) {
      errors.push(
        `Factor "${factor.label}" weight must be a positive whole number.`
      );
    }
    if (
      !Number.isInteger(factor.minScore) ||
      !Number.isInteger(factor.maxScore) ||
      factor.minScore > factor.maxScore
    ) {
      errors.push(`Factor "${factor.label}" has an invalid score range.`);
    }
  }

  if (thresholds.length === 0) {
    errors.push("At least one priority threshold is required.");
  }

  const seenLevels = new Set<string>();
  for (const threshold of thresholds) {
    if (!threshold.level || threshold.level.trim() === "") {
      errors.push("Each threshold needs a level name.");
    } else if (seenLevels.has(threshold.level)) {
      errors.push(`Duplicate priority level "${threshold.level}".`);
    }
    seenLevels.add(threshold.level);

    if (
      !Number.isInteger(threshold.minScore) ||
      !Number.isInteger(threshold.maxScore) ||
      threshold.minScore > threshold.maxScore
    ) {
      errors.push(`Threshold "${threshold.level}" has an invalid score range.`);
    }
  }

  if (errors.length === 0 && activeFactors.length > 0) {
    const minPossible = activeFactors.reduce(
      (sum, f) => sum + f.minScore * f.weight,
      0
    );
    const maxPossible = activeFactors.reduce(
      (sum, f) => sum + f.maxScore * f.weight,
      0
    );
    const sorted = [...thresholds].sort((a, b) => a.minScore - b.minScore);

    if (sorted[0].minScore !== minPossible) {
      errors.push(
        `The lowest threshold must start at ${minPossible} (the minimum possible score).`
      );
    }
    if (sorted[sorted.length - 1].maxScore !== maxPossible) {
      errors.push(
        `The highest threshold must end at ${maxPossible} (the maximum possible score).`
      );
    }
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i].minScore <= sorted[i - 1].maxScore) {
        errors.push(
          `Thresholds "${sorted[i - 1].level}" and "${sorted[i].level}" overlap.`
        );
      } else if (sorted[i].minScore !== sorted[i - 1].maxScore + 1) {
        errors.push(
          `Thresholds must be contiguous: "${sorted[i - 1].level}" ends at ${sorted[i - 1].maxScore} but "${sorted[i].level}" starts at ${sorted[i].minScore}.`
        );
      }
    }
  }

  return errors;
}
