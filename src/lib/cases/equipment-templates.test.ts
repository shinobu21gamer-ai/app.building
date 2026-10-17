import { describe, expect, it } from "vitest";
import { suggestedEquipment } from "./equipment-templates";

describe("suggestedEquipment", () => {
  it("names the heavy gear a road repair needs, rented by the day", () => {
    const lines = suggestedEquipment({ categoryCode: "ROAD", typeKey: "REPAIR" });
    expect(lines.map((line) => line.name)).toEqual([
      "Backhoe",
      "Dump truck",
      "Concrete mixer",
      "Plate compactor",
    ]);
    const backhoe = lines[0];
    expect(backhoe.unit).toBe("days");
    // qty × rate is the line amount the form will show.
    expect(Number(backhoe.quantity) * Number(backhoe.unitPrice)).toBe(
      Number(backhoe.amount)
    );
  });

  it("suggests drainage gear for a drainage concern", () => {
    const lines = suggestedEquipment({
      categoryCode: "DRAINAGE",
      typeKey: "REPAIR",
    });
    expect(lines.map((line) => line.name)).toContain("Water pump");
  });

  it("falls back to the general repair kit by service type", () => {
    const lines = suggestedEquipment({ categoryCode: null, typeKey: "REPAIR" });
    expect(lines.length).toBeGreaterThan(0);
  });

  it("suggests no equipment for money-only service types", () => {
    for (const typeKey of ["AYUDA", "DOCUMENTS", "BUDGET"]) {
      expect(suggestedEquipment({ categoryCode: null, typeKey })).toEqual([]);
    }
    expect(suggestedEquipment({ categoryCode: null, typeKey: null })).toEqual([]);
  });

  it("returns a fresh array the caller may edit", () => {
    const first = suggestedEquipment({ categoryCode: "ROAD", typeKey: null });
    first[0].name = "Changed";
    const second = suggestedEquipment({ categoryCode: "ROAD", typeKey: null });
    expect(second[0].name).toBe("Backhoe");
  });
});
