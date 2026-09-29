import { describe, expect, it } from "vitest";
import { parseNotificationFilters } from "./query";

describe("parseNotificationFilters", () => {
  it("defaults to a 100-item cap and no filters", () => {
    const filters = parseNotificationFilters(new URLSearchParams());
    expect(filters.limit).toBe(100);
    expect(filters.unread).toBe(false);
    expect(filters.concernId).toBeNull();
  });

  it("parses the unread flag", () => {
    expect(
      parseNotificationFilters(new URLSearchParams("unread=true")).unread
    ).toBe(true);
    expect(
      parseNotificationFilters(new URLSearchParams("unread=false")).unread
    ).toBe(false);
  });

  it("caps the limit at 200 and ignores invalid values", () => {
    expect(
      parseNotificationFilters(new URLSearchParams("limit=9999")).limit
    ).toBe(200);
    expect(
      parseNotificationFilters(new URLSearchParams("limit=0")).limit
    ).toBe(100);
    expect(
      parseNotificationFilters(new URLSearchParams("limit=banana")).limit
    ).toBe(100);
  });

  it("accepts only positive integer concern ids", () => {
    expect(
      parseNotificationFilters(new URLSearchParams("concernId=42")).concernId
    ).toBe(42);
    expect(
      parseNotificationFilters(new URLSearchParams("concernId=-1")).concernId
    ).toBeNull();
  });
});