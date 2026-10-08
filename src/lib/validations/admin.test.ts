import { describe, expect, it } from "vitest";
import { officeCreateSchema, officeUpdateSchema } from "./admin";

const validOffice = {
  name: "Infrastructure Office",
  code: "INFRA",
  contact: "0917-000-0001",
  location: "Barangay Hall, Sample City",
};

describe("office validation", () => {
  it("requires a contact and an address or map pin when creating an office", () => {
    expect(officeCreateSchema.safeParse(validOffice).success).toBe(true);
    expect(
      officeCreateSchema.safeParse({ ...validOffice, contact: "" }).success
    ).toBe(false);
    expect(
      officeCreateSchema.safeParse({
        name: validOffice.name,
        code: validOffice.code,
        contact: validOffice.contact,
      }).success
    ).toBe(false);
  });

  it("accepts a Leaflet map pin without a typed address", () => {
    const result = officeCreateSchema.safeParse({
      name: validOffice.name,
      code: validOffice.code,
      contact: validOffice.contact,
      location: "",
      latitude: 14.5995,
      longitude: 120.9842,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.location).toBeNull();
      expect(result.data.latitude).toBe(14.5995);
      expect(result.data.longitude).toBe(120.9842);
    }
  });

  it("rejects out-of-range or incomplete map coordinates", () => {
    expect(
      officeCreateSchema.safeParse({
        ...validOffice,
        latitude: 91,
        longitude: 120,
      }).success
    ).toBe(false);
    expect(
      officeCreateSchema.safeParse({
        ...validOffice,
        latitude: 14,
      }).success
    ).toBe(false);
  });

  it("requires a contact when a contact is changed, but allows status-only updates", () => {
    expect(officeUpdateSchema.safeParse({ isActive: false }).success).toBe(true);
    expect(officeUpdateSchema.safeParse({ contact: "" }).success).toBe(false);
    expect(officeUpdateSchema.safeParse({ contact: "0917-123-4567" }).success).toBe(true);
  });

  it("prevents removing both forms of an office location", () => {
    expect(
      officeUpdateSchema.safeParse({ location: "", latitude: null, longitude: null }).success
    ).toBe(false);
    expect(
      officeUpdateSchema.safeParse({ location: "New Hall", latitude: null, longitude: null }).success
    ).toBe(true);
  });
});
