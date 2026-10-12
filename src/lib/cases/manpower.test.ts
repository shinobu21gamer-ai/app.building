import { describe, expect, it } from "vitest";
import {
  crewCoverage,
  durationLabel,
  estimateLaborCost,
  formatPeso,
  isValidDurationMinutes,
  isValidWorkersNeeded,
  manualLaborEstimate,
  roundMoney,
  totalCostEstimate,
} from "./manpower";

describe("workers needed", () => {
  it("accepts whole numbers of at least one", () => {
    expect(isValidWorkersNeeded(1)).toBe(true);
    expect(isValidWorkersNeeded(7)).toBe(true);
    expect(isValidWorkersNeeded(0)).toBe(false);
    expect(isValidWorkersNeeded(1.5)).toBe(false);
    expect(isValidWorkersNeeded("3")).toBe(false);
    expect(isValidWorkersNeeded(101)).toBe(false);
  });

  it("requires a duration between 15 minutes and 90 days", () => {
    expect(isValidDurationMinutes(15)).toBe(true);
    expect(isValidDurationMinutes(60 * 24 * 90)).toBe(true);
    expect(isValidDurationMinutes(14)).toBe(false);
    expect(isValidDurationMinutes(60 * 24 * 91)).toBe(false);
  });
});

describe("labour estimate", () => {
  it("prefers an hourly rate", () => {
    const estimate = estimateLaborCost({
      workers: 3,
      durationMinutes: 480,
      hourlyRate: 100,
      dailyRate: 600,
    });
    expect(estimate?.laborCost).toBe(2400);
    expect(estimate?.basis.computedFrom).toBe("hourly");
    expect(estimate?.basis.hours).toBe(8);
    expect(estimate?.basis.days).toBe(1);
  });

  it("pro-rates a daily rate over the working day", () => {
    const estimate = estimateLaborCost({
      workers: 2,
      durationMinutes: 240,
      dailyRate: 600,
    });
    // half a day each at 600/day
    expect(estimate?.laborCost).toBe(600);
    expect(estimate?.basis.computedFrom).toBe("daily");
  });

  it("returns null without a rate so the caller must supply a figure", () => {
    expect(
      estimateLaborCost({ workers: 2, durationMinutes: 120 })
    ).toBeNull();
    expect(estimateLaborCost({ workers: 0, durationMinutes: 120, hourlyRate: 50 })).toBeNull();
  });

  it("records a manual figure as such", () => {
    const manual = manualLaborEstimate({
      workers: 4,
      durationMinutes: 480,
      laborCost: 3000,
    });
    expect(manual.laborCost).toBe(3000);
    expect(manual.basis.computedFrom).toBe("manual");
    expect(manual.basis.days).toBe(1);
  });
});

describe("cost estimate", () => {
  it("always includes labour in the total", () => {
    const cost = totalCostEstimate({
      laborCost: 1500,
      materialsCost: 250.555,
      equipmentCost: 100,
    });
    expect(cost.laborCost).toBe(1500);
    expect(cost.materialsCost).toBe(250.56);
    expect(cost.otherCost).toBe(0);
    expect(cost.totalCost).toBe(1850.56);
  });

  it("rounds to centavos", () => {
    expect(roundMoney(0.005)).toBe(0.01);
    expect(totalCostEstimate({ laborCost: 1.005 }).totalCost).toBe(1.01);
  });
});

describe("presentation helpers", () => {
  it("labels durations in days and hours", () => {
    expect(durationLabel(480)).toBe("1 day");
    expect(durationLabel(480 + 240)).toBe("1 day 4 hours");
    expect(durationLabel(30)).toBe("30 min");
    expect(durationLabel(0)).toBe("0 min");
  });

  it("formats pesos", () => {
    expect(formatPeso(1234.5)).toBe("₱1,234.50");
    expect(formatPeso("0")).toBe("₱0.00");
    expect(formatPeso(null)).toBe("—");
  });
});

describe("crew coverage", () => {
  it("reports a shortfall against the plan", () => {
    expect(crewCoverage({ required: 3, assigned: 2 })).toEqual({
      satisfied: false,
      shortfall: 1,
      label: "2 of 3 assigned",
    });
    expect(crewCoverage({ required: 3, assigned: 3 }).satisfied).toBe(true);
  });

  it("does not gate a case without a plan", () => {
    expect(crewCoverage({ required: null, assigned: 0 })).toEqual({
      satisfied: true,
      shortfall: 0,
      label: "0 assigned",
    });
  });
});
