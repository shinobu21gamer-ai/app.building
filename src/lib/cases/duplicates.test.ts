import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { concern: { findMany: mocks.findMany } } }));

import { findLikelyDuplicate } from "./duplicates";

beforeEach(() => mocks.findMany.mockReset());

describe("findLikelyDuplicate", () => {
  it("finds a recent matching concern regardless of which resident filed it", async () => {
    mocks.findMany.mockResolvedValue([
      { id: 31, title: "Broken street light", locationAddress: "Poblacion - Mabini Street" },
    ]);

    await expect(findLikelyDuplicate({
      categoryId: 4,
      title: "Broken street light",
      locationAddress: "Poblacion - Mabini Street",
    })).resolves.toBe(31);

    const query = mocks.findMany.mock.calls[0][0];
    expect(query.where.categoryId).toBe(4);
    expect(query.where).not.toHaveProperty("userId");
    expect(query.where.status).toEqual({ not: "CLOSED" });
  });

  it("does not match the same title at a different location", async () => {
    mocks.findMany.mockResolvedValue([
      { id: 31, title: "Broken street light", locationAddress: "Poblacion - Mabini Street" },
    ]);

    await expect(findLikelyDuplicate({
      categoryId: 4,
      title: "Broken street light",
      locationAddress: "Poblacion - Rizal Street",
    })).resolves.toBeNull();
  });
});
