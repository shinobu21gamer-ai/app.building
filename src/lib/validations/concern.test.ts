import { describe, expect, it } from "vitest";
import { trackConcernSchema } from "./concern";

describe("trackConcernSchema", () => {
  it("accepts a padded case number and lowercases email", () => {
    const result = trackConcernSchema.safeParse({
      caseNumber: " br-20261009-0001 ",
      email: "  RESIDENT@Example.COM ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.caseNumber).toBe("BR-20261009-0001");
      expect(result.data.email).toBe("resident@example.com");
    }
  });

  it("allows sequences longer than four digits", () => {
    const result = trackConcernSchema.safeParse({
      caseNumber: "BR-20261009-10000",
      email: "a@b.com",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a malformed case number", () => {
    const result = trackConcernSchema.safeParse({
      caseNumber: "BR-1",
      email: "a@b.com",
    });
    expect(result.success).toBe(false);
  });
});
