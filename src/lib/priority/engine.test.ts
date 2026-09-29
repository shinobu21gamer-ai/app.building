import { describe, expect, it } from "vitest";
import {
  evaluatePriority,
  PriorityRuleError,
  resolveThreshold,
  validatePriorityConfiguration,
  type FactorConfig,
  type ThresholdConfig,
} from "./engine";

const FACTORS: FactorConfig[] = [
  {
    key: "URGENCY",
    label: "Urgency",
    weight: 3,
    minScore: 1,
    maxScore: 5,
    displayOrder: 1,
  },
  {
    key: "IMPACT",
    label: "Impact",
    weight: 2,
    minScore: 1,
    maxScore: 5,
    displayOrder: 2,
  },
];

const THRESHOLDS: ThresholdConfig[] = [
  { level: "LOW", minScore: 5, maxScore: 10, isActive: true },
  { level: "MEDIUM", minScore: 11, maxScore: 18, isActive: true },
  { level: "HIGH", minScore: 19, maxScore: 25, isActive: true },
];

describe("evaluatePriority", () => {
  it("computes the weighted total and level", () => {
    // urgency 4 x 3 = 12, impact 3 x 2 = 6 -> total 18 -> MEDIUM
    const result = evaluatePriority(
      { urgencyScore: 4, impactScore: 3 },
      FACTORS,
      THRESHOLDS
    );
    expect(result.totalScore).toBe(18);
    expect(result.level).toBe("MEDIUM");
    expect(result.minPossible).toBe(5);
    expect(result.maxPossible).toBe(25);
    expect(result.factors).toHaveLength(2);
    expect(result.factors[0].weightedScore).toBe(12);
  });

  it("respects display order and honors inactive factor skipping", () => {
    const withInactive: FactorConfig[] = [
      { ...FACTORS[0], displayOrder: 2 },
      { ...FACTORS[1], displayOrder: 1 },
      {
        key: "SAFETY",
        label: "Safety",
        weight: 1,
        minScore: 1,
        maxScore: 5,
        displayOrder: 0,
        isActive: false,
      },
    ];
    const result = evaluatePriority(
      { urgencyScore: 5, impactScore: 5 },
      withInactive,
      THRESHOLDS
    );
    expect(result.factors.map((f) => f.key)).toEqual(["IMPACT", "URGENCY"]);
    expect(result.totalScore).toBe(25);
  });

  it("throws when scores are out of range", () => {
    expect(() =>
      evaluatePriority(
        { urgencyScore: 6, impactScore: 3 },
        FACTORS,
        THRESHOLDS
      )
    ).toThrow(PriorityRuleError);
  });

  it("throws when no active factors or thresholds exist", () => {
    expect(() => evaluatePriority({}, [], THRESHOLDS)).toThrow(PriorityRuleError);
    expect(() => evaluatePriority({}, FACTORS, [])).toThrow(PriorityRuleError);
  });
});

describe("resolveThreshold", () => {
  it("prefers an exact range match", () => {
    expect(resolveThreshold(18, THRESHOLDS)?.level).toBe("MEDIUM");
    expect(resolveThreshold(25, THRESHOLDS)?.level).toBe("HIGH");
  });

  it("falls back to the highest lower bound at or below the score", () => {
    expect(resolveThreshold(40, THRESHOLDS)?.level).toBe("HIGH");
    expect(resolveThreshold(3, THRESHOLDS)).toBeNull();
  });
});

describe("validatePriorityConfiguration", () => {
  it("accepts a contiguous, exact coverage config", () => {
    expect(validatePriorityConfiguration(FACTORS, THRESHOLDS)).toEqual([]);
  });

  it("flags gaps, overlaps and out-of-bound thresholds", () => {
    const gap = [
      { level: "LOW", minScore: 5, maxScore: 11, isActive: true },
      { level: "HIGH", minScore: 19, maxScore: 25, isActive: true },
    ];
    const problems = validatePriorityConfiguration(FACTORS, gap);
    expect(problems.join(" ")).toContain("contiguous");
  });

  it("flags duplicate threshold levels", () => {
    const dup = [
      { level: "LOW", minScore: 5, maxScore: 15, isActive: true },
      { level: "MEDIUM", minScore: 16, maxScore: 25, isActive: true },
      { level: "LOW", minScore: 1, maxScore: 4, isActive: true },
    ];
    const problems = validatePriorityConfiguration(FACTORS, dup);
    expect(problems.join(" ")).toContain('Duplicate priority level "LOW"');
  });
});