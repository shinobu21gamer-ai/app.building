import { describe, expect, it } from "vitest";
import { planNeeds } from "./plan-needs";

describe("planNeeds", () => {
  it("asks for no equipment or budget on a noise complaint", () => {
    expect(planNeeds({ categoryCode: "NOISE", typeKey: "DOCUMENTS" })).toEqual({
      crew: false,
      budget: false,
      equipment: false,
      materials: false,
    });
  });

  it("keeps equipment, materials, crew and budget on a road repair", () => {
    expect(planNeeds({ categoryCode: "ROAD", typeKey: "REPAIR" })).toEqual({
      crew: true,
      budget: true,
      equipment: true,
      materials: true,
    });
  });

  it("keeps the repair plan when an old or incorrect category says document request", () => {
    expect(planNeeds({ categoryCode: "DOC_REQUEST", typeKey: "REPAIR" })).toEqual({
      crew: true,
      budget: true,
      equipment: true,
      materials: true,
    });
  });

  it("asks for money but not a crew on ayuda", () => {
    expect(planNeeds({ typeKey: "AYUDA" })).toEqual({
      crew: false,
      budget: true,
      equipment: false,
      materials: false,
    });
  });
});
