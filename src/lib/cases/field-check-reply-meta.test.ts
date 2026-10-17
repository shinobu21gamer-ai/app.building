import { describe, expect, it } from "vitest";
import { fieldCheckIdFromMetadata } from "./field-check-reply-meta";

describe("fieldCheckIdFromMetadata", () => {
  it("reads a numeric field-check reference", () => {
    expect(fieldCheckIdFromMetadata('{"fieldCheckId":12}')).toBe(12);
  });

  it("ignores malformed or unrelated metadata", () => {
    expect(fieldCheckIdFromMetadata(null)).toBeNull();
    expect(fieldCheckIdFromMetadata("not-json")).toBeNull();
    expect(fieldCheckIdFromMetadata('{"fieldCheckId":"12"}')).toBeNull();
  });
});
