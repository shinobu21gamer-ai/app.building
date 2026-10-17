import { describe, expect, it } from "vitest";
import {
  categoryCreateSchema,
  categoryUpdateSchema,
  officeCreateSchema,
  officeUpdateSchema,
} from "./admin";

const validOffice = {
  name: "Infrastructure Office",
  code: "INFRA",
  contact: "0917-000-0001",
};

describe("office validation", () => {
  it("creates an office with contact details and no map or location fields", () => {
    expect(officeCreateSchema.safeParse(validOffice).success).toBe(true);

    const result = officeCreateSchema.safeParse({
      ...validOffice,
      location: "Barangay Hall, Sample City",
      latitude: 14.5995,
      longitude: 120.9842,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("location");
      expect(result.data).not.toHaveProperty("latitude");
      expect(result.data).not.toHaveProperty("longitude");
    }
  });

  it("requires contact details when creating an office", () => {
    expect(
      officeCreateSchema.safeParse({ ...validOffice, contact: "" }).success
    ).toBe(false);
    expect(
      officeCreateSchema.safeParse({
        name: validOffice.name,
        code: validOffice.code,
      }).success
    ).toBe(false);
  });

  it("requires a valid contact when changed, but allows status-only updates", () => {
    expect(officeUpdateSchema.safeParse({ isActive: false }).success).toBe(true);
    expect(officeUpdateSchema.safeParse({ contact: "" }).success).toBe(false);
    expect(
      officeUpdateSchema.safeParse({ contact: "0917-123-4567" }).success
    ).toBe(true);
  });
});

describe("category validation", () => {
  const validCategory = { name: "Health Concern", code: "HEALTH" };

  it("connects a category to a service type on create", () => {
    const result = categoryCreateSchema.safeParse({
      ...validCategory,
      typeId: 3,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.typeId).toBe(3);
  });

  it("allows creating a category that is not connected yet", () => {
    const result = categoryCreateSchema.safeParse(validCategory);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.typeId).toBeUndefined();
  });

  it("rejects a service type id that is not a positive integer", () => {
    expect(
      categoryCreateSchema.safeParse({ ...validCategory, typeId: 0 }).success
    ).toBe(false);
    expect(
      categoryCreateSchema.safeParse({ ...validCategory, typeId: "abc" })
        .success
    ).toBe(false);
  });

  it("disconnects a category with an explicit null and leaves it alone when omitted", () => {
    const disconnected = categoryUpdateSchema.safeParse({ typeId: null });
    expect(disconnected.success).toBe(true);
    if (disconnected.success) expect(disconnected.data.typeId).toBeNull();

    const untouched = categoryUpdateSchema.safeParse({ isActive: false });
    expect(untouched.success).toBe(true);
    if (untouched.success) expect(untouched.data.typeId).toBeUndefined();
  });
});
