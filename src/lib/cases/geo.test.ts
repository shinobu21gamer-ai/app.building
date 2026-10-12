import { describe, expect, it } from "vitest";
import {
  buildPublicRef,
  coarsenCoordinate,
  encodeGeohash,
  scrubPublicTitle,
} from "./geo";

describe("encodeGeohash", () => {
  it("encodes known coordinates", () => {
    // Manila City Hall area, and the canonical Wikipedia example.
    expect(encodeGeohash(14.5906, 120.9813, 5)).toHaveLength(5);
    expect(encodeGeohash(57.64911, 10.40744, 11)).toBe("u4pruydqqvj");
  });

  it("is stable for nearby points at low precision", () => {
    expect(encodeGeohash(14.5906, 120.9813, 5)).toBe(
      encodeGeohash(14.5907, 120.9812, 5)
    );
  });
});

describe("coarsenCoordinate", () => {
  it("rounds to two decimals", () => {
    expect(coarsenCoordinate(14.59061234)).toBe(14.59);
    expect(coarsenCoordinate(120.981399)).toBe(120.98);
  });
});

describe("scrubPublicTitle", () => {
  it("removes contact details and house numbers", () => {
    expect(
      scrubPublicTitle("Baha sa 123 Mabini St, tawag 0917 123 4567")
    ).toBe("Baha sa Mabini St, tawag");
  });

  it("removes the resident's own names", () => {
    expect(
      scrubPublicTitle("Reklamo ni Juan Dela Cruz tungkol sa basura", [
        "Juan",
        "Dela Cruz",
      ])
    ).toBe("Reklamo ni tungkol sa basura");
  });

  it("returns null when nothing safe survives", () => {
    expect(scrubPublicTitle("0917 123 4567")).toBeNull();
    expect(scrubPublicTitle("12")).toBeNull();
    expect(scrubPublicTitle("Juan", ["Juan"])).toBeNull();
  });

  it("keeps a normal title intact and bounds its length", () => {
    expect(scrubPublicTitle("Sirang streetlight sa Purok 3")).toBe(
      "Sirang streetlight sa Purok"
    );
    expect(
      scrubPublicTitle("A".repeat(200))?.length
    ).toBe(90);
  });
});

describe("buildPublicRef", () => {
  it("never derives from the case number", () => {
    const ref = buildPublicRef(42, "ab12");
    expect(ref.startsWith("BR-PUB-")).toBe(true);
    expect(ref).not.toContain("BR-2026");
    expect(buildPublicRef(42, "ab12")).toBe(ref);
  });
});
