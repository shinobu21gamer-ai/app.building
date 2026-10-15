import { describe, expect, it } from "vitest";
import {
  affectedBandFromCount,
  affectedBandFromScore,
  affectedScoreFromCount,
  describeAffectedPeople,
} from "./affected";

describe("affected population banding", () => {
  it("bands a headcount onto the 1–5 score scale", () => {
    expect(affectedScoreFromCount(1)).toBe(1);
    expect(affectedScoreFromCount(4)).toBe(1);
    expect(affectedScoreFromCount(5)).toBe(2);
    expect(affectedScoreFromCount(19)).toBe(2);
    expect(affectedScoreFromCount(20)).toBe(3);
    expect(affectedScoreFromCount(99)).toBe(3);
    expect(affectedScoreFromCount(100)).toBe(4);
    expect(affectedScoreFromCount(499)).toBe(4);
    expect(affectedScoreFromCount(500)).toBe(5);
  });

  it("keeps the top band open, so a case can affect more than five people", () => {
    expect(affectedScoreFromCount(5_000)).toBe(5);
    expect(affectedScoreFromCount(250_000)).toBe(5);
    expect(affectedBandFromCount(250_000).max).toBeNull();
  });

  it("treats zero and negative input as the first band instead of crashing", () => {
    expect(affectedScoreFromCount(0)).toBe(1);
    expect(affectedScoreFromCount(-12)).toBe(1);
    expect(affectedScoreFromCount(Number.NaN)).toBe(5);
  });

  it("reads a stored score back as the range it stands for", () => {
    expect(affectedBandFromScore(4)?.min).toBe(100);
    expect(affectedBandFromScore(4)?.max).toBe(499);
    expect(affectedBandFromScore(9)).toBeNull();
  });

  it("describes what was recorded in words a case sheet can print", () => {
    expect(describeAffectedPeople(250)).toBe(
      "250 people → score 4 of 5 (100–499 people (several puroks))"
    );
    expect(describeAffectedPeople(null)).toBeNull();
  });
});
