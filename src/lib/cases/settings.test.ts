import { describe, expect, it } from "vitest";
import { DEFAULT_BARANGAY_AREAS, parseBarangayAreas } from "./settings";

describe("parseBarangayAreas", () => {
  it("falls back to the default list", () => {
    expect(parseBarangayAreas(null)).toEqual(DEFAULT_BARANGAY_AREAS);
    expect(parseBarangayAreas("   \n  ")).toEqual(DEFAULT_BARANGAY_AREAS);
  });

  it("keeps one unique area per line", () => {
    expect(parseBarangayAreas("Sitio Malaya\nPurok 1\npurok 1\n\nSchool Zone")).toEqual([
      "Sitio Malaya",
      "Purok 1",
      "School Zone",
    ]);
  });
});
