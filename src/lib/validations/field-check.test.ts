import { describe, expect, it } from "vitest";
import { residentFieldCheckReplySchema } from "./field-check";

describe("residentFieldCheckReplySchema", () => {
  it("trims and accepts a non-empty reply", () => {
    expect(residentFieldCheckReplySchema.parse({ message: "  Please check again.  " })).toEqual({
      message: "Please check again.",
    });
  });

  it("rejects blank messages and replies over 1,000 characters", () => {
    expect(residentFieldCheckReplySchema.safeParse({ message: "   " }).success).toBe(false);
    expect(residentFieldCheckReplySchema.safeParse({ message: "x".repeat(1001) }).success).toBe(false);
  });
});
