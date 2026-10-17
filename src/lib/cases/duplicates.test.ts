import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { concern: { findMany: mocks.findMany } } }));

import {
  decideDuplicateSubmission,
  findLikelyDuplicate,
} from "./duplicates";

beforeEach(() => mocks.findMany.mockReset());

describe("decideDuplicateSubmission", () => {
  const match = { id: 31, sameResident: false } as const;

  it("asks for a resident decision before a similar report is filed", () => {
    expect(decideDuplicateSubmission(match, false)).toEqual({
      kind: "REVIEW",
      match,
    });
  });

  it("treats an explicitly confirmed separate issue as a new, unlinked case", () => {
    expect(decideDuplicateSubmission(match, true)).toEqual({
      kind: "CREATE",
      duplicateOfId: null,
    });
  });

  it("allows a report when no possible duplicate was found", () => {
    expect(decideDuplicateSubmission(null, false)).toEqual({
      kind: "CREATE",
      duplicateOfId: null,
    });
  });
});

describe("findLikelyDuplicate", () => {
  it("returns a safe link to the matching concern when the same resident filed it", async () => {
    mocks.findMany.mockResolvedValue([
      {
        id: 31,
        userId: 7,
        caseNumber: "BR-20261016-0031",
        status: "ASSIGNED",
        title: "Broken street light",
        locationAddress: "Poblacion - Mabini Street",
      },
    ]);

    await expect(findLikelyDuplicate({
      userId: 7,
      categoryId: 4,
      title: "Broken street light",
      locationAddress: "Poblacion - Mabini Street",
    })).resolves.toEqual({
      id: 31,
      sameResident: true,
      caseNumber: "BR-20261016-0031",
      title: "Broken street light",
      status: "ASSIGNED",
    });

    const query = mocks.findMany.mock.calls[0][0];
    expect(query.where.categoryId).toBe(4);
    expect(query.where).not.toHaveProperty("userId");
    expect(query.where.status).toEqual({ notIn: ["CLOSED", "RESOLVED"] });
  });

  it("prefers the resident's own matching case when several reports match", async () => {
    mocks.findMany.mockResolvedValue([
      {
        id: 30,
        userId: 88,
        caseNumber: "BR-20261016-0030",
        status: "ASSIGNED",
        title: "Broken street light",
        locationAddress: "Poblacion - Mabini Street",
      },
      {
        id: 31,
        userId: 7,
        caseNumber: "BR-20261016-0031",
        status: "ASSIGNED",
        title: "Broken street light",
        locationAddress: "Poblacion - Mabini Street",
      },
    ]);

    await expect(findLikelyDuplicate({
      userId: 7,
      categoryId: 4,
      title: "Broken street light",
      locationAddress: "Poblacion - Mabini Street",
    })).resolves.toMatchObject({ id: 31, sameResident: true });
  });

  it("does not expose another resident's case details in a duplicate match", async () => {
    mocks.findMany.mockResolvedValue([
      {
        id: 31,
        userId: 88,
        caseNumber: "BR-20261016-0031",
        status: "ASSIGNED",
        title: "Broken street light",
        locationAddress: "Poblacion - Mabini Street",
      },
    ]);

    await expect(findLikelyDuplicate({
      userId: 7,
      categoryId: 4,
      title: "Broken street light",
      locationAddress: "Poblacion - Mabini Street",
    })).resolves.toEqual({ id: 31, sameResident: false });
  });

  it("does not match the same title at a different location", async () => {
    mocks.findMany.mockResolvedValue([
      { id: 31, title: "Broken street light", locationAddress: "Poblacion - Mabini Street" },
    ]);

    await expect(findLikelyDuplicate({
      userId: 7,
      categoryId: 4,
      title: "Broken street light",
      locationAddress: "Poblacion - Rizal Street",
    })).resolves.toBeNull();
  });
});
