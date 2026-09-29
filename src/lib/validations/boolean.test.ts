import { describe, expect, it } from "vitest";
import { booleanFlag } from "./boolean";

describe("booleanFlag", () => {
  it("keeps real booleans untouched", () => {
    const schema = booleanFlag;
    expect(schema.parse(true)).toBe(true);
    expect(schema.parse(false)).toBe(false);
  });

  it("maps common form encodings", () => {
    const schema = booleanFlag;
    expect(schema.parse("true")).toBe(true);
    expect(schema.parse("1")).toBe(true);
    expect(schema.parse("false")).toBe(false);
    expect(schema.parse("0")).toBe(false);
  });

  it("rejects values z.coerce.boolean() would have turned into true", () => {
    const schema = booleanFlag;
    // Every one of these is a truthy string, so z.coerce.boolean() returned
    // true for all of them (silently enabling what the caller meant to disable).
    for (const value of ["no", "", "maybe", "2", "on"]) {
      expect(schema.safeParse(value).success).toBe(false);
    }
  });
});
