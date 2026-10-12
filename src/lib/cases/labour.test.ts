import { describe, expect, it } from "vitest";
import { averageRates, crewLabour, labourStartMessage } from "./labour";

const EIGHT_HOURS = 480;

describe("crewLabour: no crew, no payment", () => {
  it("is zero with nobody assigned, even when the office has rates", () => {
    const result = crewLabour({
      crew: [],
      durationMinutes: EIGHT_HOURS,
      fallback: { hourlyRate: 100, dailyRate: 800 },
      manualFigure: 5000,
    });
    expect(result.cost).toBe(0);
    expect(result.basis.computedFrom).toBe("no_crew");
    expect(result.basis.workers).toBe(0);
    // The figure is kept, so it still applies once crew are assigned.
    expect(result.basis.manualFigure).toBe(5000);
  });
});

describe("crewLabour: priced from the crew actually assigned", () => {
  it("keeps a figure entered before crew were assigned, for the first assignment", () => {
    const noCrew = crewLabour({ crew: [], durationMinutes: EIGHT_HOURS, fallback: null, manualFigure: 700 });
    const oneCrew = crewLabour({
      crew: [{ hourlyRate: null, dailyRate: null }],
      durationMinutes: EIGHT_HOURS,
      fallback: null,
      manualFigure: noCrew.basis.manualFigure ?? null,
    });
    expect(noCrew.cost).toBe(0);
    expect(oneCrew.cost).toBe(700);
    expect(oneCrew.basis.computedFrom).toBe("manual");
  });

  it("prices one person at their daily rate", () => {
    const result = crewLabour({
      crew: [{ hourlyRate: null, dailyRate: 800 }],
      durationMinutes: EIGHT_HOURS,
      fallback: null,
      manualFigure: null,
    });
    expect(result.cost).toBe(800);
    expect(result.basis.computedFrom).toBe("daily");
    expect(result.basis.crewRatesUsed).toBe(1);
  });

  it("sums each assigned person at their own hourly rate", () => {
    const result = crewLabour({
      crew: [
        { hourlyRate: 100, dailyRate: null },
        { hourlyRate: 100, dailyRate: null },
      ],
      durationMinutes: 240,
      fallback: null,
      manualFigure: null,
    });
    expect(result.cost).toBe(800);
    expect(result.basis.computedFrom).toBe("hourly");
    expect(result.basis.workers).toBe(2);
  });

  it("uses the office average for a person with no rate of their own", () => {
    const result = crewLabour({
      crew: [{ hourlyRate: null, dailyRate: null }],
      durationMinutes: 120,
      fallback: { hourlyRate: 50, dailyRate: null },
      manualFigure: null,
    });
    expect(result.cost).toBe(100);
  });

  it("ignores the manual figure once crew can be priced", () => {
    const result = crewLabour({
      crew: [{ hourlyRate: 100, dailyRate: null }],
      durationMinutes: 240,
      fallback: null,
      manualFigure: 9999,
    });
    expect(result.cost).toBe(400);
    expect(result.basis.manualFigure).toBe(9999);
  });
});

describe("crewLabour: no rate on file", () => {
  it("uses the manual figure for the crew as a group when crew are assigned", () => {
    const result = crewLabour({
      crew: [{ hourlyRate: null, dailyRate: null }, { hourlyRate: null, dailyRate: null }],
      durationMinutes: EIGHT_HOURS,
      fallback: null,
      manualFigure: 3000,
    });
    expect(result.cost).toBe(3000);
    expect(result.basis.computedFrom).toBe("manual");
    expect(result.basis.manualFigure).toBe(3000);
  });

  it("is zero, and flagged, when crew are assigned but there is no rate and no figure", () => {
    const result = crewLabour({
      crew: [{ hourlyRate: null, dailyRate: null }],
      durationMinutes: EIGHT_HOURS,
      fallback: null,
      manualFigure: null,
    });
    expect(result.cost).toBe(0);
    expect(result.basis.computedFrom).toBe("no_rate");
  });
});

describe("averageRates", () => {
  it("averages the rates that are on file", () => {
    expect(
      averageRates([
        { hourlyRate: 100, dailyRate: null },
        { hourlyRate: 200, dailyRate: 900 },
      ])
    ).toEqual({ hourlyRate: 150, dailyRate: 900 });
  });

  it("returns null when no profile has a rate", () => {
    expect(averageRates([{ hourlyRate: null, dailyRate: null }])).toBeNull();
    expect(averageRates([])).toBeNull();
  });
});

describe("labourStartMessage: unpriced labour blocks work", () => {
  it("blocks only when crew are assigned and nothing prices them", () => {
    expect(labourStartMessage("no_rate")).toMatch(/cannot be priced yet/);
  });

  it("does not block priced, manual, or no-crew labour", () => {
    expect(labourStartMessage("hourly")).toBeNull();
    expect(labourStartMessage("daily")).toBeNull();
    expect(labourStartMessage("manual")).toBeNull();
    expect(labourStartMessage("no_crew")).toBeNull();
    expect(labourStartMessage(undefined)).toBeNull();
  });
});
