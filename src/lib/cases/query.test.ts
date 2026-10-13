import { describe, expect, it } from "vitest";
import { parseConcernFilters } from "./query";

describe("parseConcernFilters", () => {
  it("normalizes valid status and priority filters", () => {
    const filters = parseConcernFilters(
      new URLSearchParams("status=resolved&priority=high")
    );
    expect(filters.status).toBe("RESOLVED");
    expect(filters.priority).toBe("HIGH");
  });

  it("ignores unknown statuses and priorities", () => {
    const filters = parseConcernFilters(
      new URLSearchParams("status=BOGUS&priority=NOPE")
    );
    expect(filters.status).toBeNull();
    expect(filters.priority).toBeNull();
  });

  it("trims search text and drops empty searches", () => {
    expect(parseConcernFilters(new URLSearchParams("q=   ")).q).toBeNull();
    expect(parseConcernFilters(new URLSearchParams("q=%20flood%20")).q).toBe(
      "flood"
    );
  });

  it("converts Manila date filters into UTC instants (from inclusive, to exclusive)", () => {
    const filters = parseConcernFilters(
      new URLSearchParams("from=2026-09-20&to=2026-09-21")
    );
    expect(filters.from?.toISOString()).toBe("2026-09-19T16:00:00.000Z");
    expect(filters.to?.toISOString()).toBe("2026-09-21T16:00:00.000Z");
  });

  it("clamps a future date window to today", () => {
    const filters = parseConcernFilters(
      new URLSearchParams("from=2030-01-01&to=2030-06-01"),
      "2026-10-13"
    );
    // 2026-10-13T00:00 Manila = 2026-10-12T16:00Z (from) and the exclusive end
    // is the following midnight.
    expect(filters.from?.toISOString()).toBe("2026-10-12T16:00:00.000Z");
    expect(filters.to?.toISOString()).toBe("2026-10-13T16:00:00.000Z");
  });

  it("swaps a window whose end is before its start", () => {
    const filters = parseConcernFilters(
      new URLSearchParams("from=2026-09-21&to=2026-09-20"),
      "2026-10-13"
    );
    expect(filters.from?.toISOString()).toBe("2026-09-19T16:00:00.000Z");
    expect(filters.to?.toISOString()).toBe("2026-09-21T16:00:00.000Z");
  });

  it("keeps a window that ends today", () => {
    const filters = parseConcernFilters(
      new URLSearchParams("to=2026-10-13"),
      "2026-10-13"
    );
    expect(filters.from).toBeNull();
    expect(filters.to?.toISOString()).toBe("2026-10-13T16:00:00.000Z");
  });

  it("ignores malformed numeric filters", () => {
    const filters = parseConcernFilters(
      new URLSearchParams("categoryId=abc&officeId=-3")
    );
    expect(filters.categoryId).toBeNull();
    expect(filters.officeId).toBeNull();
  });

  it("parses positive integer ids", () => {
    const filters = parseConcernFilters(
      new URLSearchParams("categoryId=2&officeId=7")
    );
    expect(filters.categoryId).toBe(2);
    expect(filters.officeId).toBe(7);
  });
});