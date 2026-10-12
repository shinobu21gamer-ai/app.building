import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
const findTypes = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    publicCaseRecord: { findMany: (...args: unknown[]) => findMany(...args) },
    concernType: { findMany: (...args: unknown[]) => findTypes(...args) },
  },
}));

import { REPORT_ROW_LIMIT, loadTransparencyData } from "@/lib/reports/transparency";

const input = { locale: "en" as const, period: { kind: "month", month: "2026-10" } as never };

function record(i: number, published: boolean) {
  return {
    status: "RESOLVED",
    typeKey: null,
    areaLabel: null,
    submittedAt: new Date("2026-10-01T00:00:00Z"),
    resolvedAt: null,
    responseHours: null,
    published,
    id: i,
  };
}

describe("transparency loader", () => {
  beforeEach(() => {
    findMany.mockReset();
    findTypes.mockReset();
    findTypes.mockResolvedValue([]);
  });

  it("asks the database for published rows only, so the row limit cannot be used up by unpublished ones", async () => {
    findMany.mockResolvedValue([record(1, true)]);
    await loadTransparencyData(input);
    expect(findMany.mock.calls[0][0].where).toEqual({ published: true });
    expect(findMany.mock.calls[0][0].take).toBe(REPORT_ROW_LIMIT + 1);
  });

  it("flags truncation only when more published rows exist than the limit", async () => {
    findMany.mockResolvedValue(
      Array.from({ length: REPORT_ROW_LIMIT + 1 }, (_, i) => record(i, true))
    );
    const data = await loadTransparencyData(input);
    expect(data.truncated).toBe(true);
    expect(data.rows).toHaveLength(REPORT_ROW_LIMIT);
  });

  it("does not count rows the database returned as unpublished", async () => {
    findMany.mockResolvedValue([record(1, true), record(2, false)]);
    const data = await loadTransparencyData(input);
    expect(data.totals.published).toBe(1);
    expect(data.truncated).toBe(false);
  });
});
