import { describe, expect, it } from "vitest";
import {
  caseNoteSchema,
  feedbackSchema,
  resolutionSchema,
  statusChangeSchema,
} from "./case";

const VALID_RESOLUTION = {
  summary: "Repaired the streetlight and patched the pothole.",
  actionsTaken: "Coordinated with the utility department and road gauge.",
  resolutionType: "FIXED",
};

describe("resolutionSchema.resolvedOn", () => {
  it("accepts a real calendar date", () => {
    const result = resolutionSchema.safeParse({
      ...VALID_RESOLUTION,
      resolvedOn: "2026-09-20",
    });
    expect(result.success).toBe(true);
  });

  it("rejects impossible calendar dates", () => {
    expect(
      resolutionSchema.safeParse({
        ...VALID_RESOLUTION,
        resolvedOn: "2026-02-30",
      }).success
    ).toBe(false);
    expect(
      resolutionSchema.safeParse({
        ...VALID_RESOLUTION,
        resolvedOn: "2026-13-01",
      }).success
    ).toBe(false);
  });

  it("rejects malformed date strings", () => {
    for (const bad of ["2026-9-20", "20/09/2026", "20260920", null]) {
      expect(
        resolutionSchema.safeParse({
          ...VALID_RESOLUTION,
          resolvedOn: bad,
        } as never).success
      ).toBe(false);
    }
  });

  it("is optional", () => {
    expect(resolutionSchema.safeParse(VALID_RESOLUTION).success).toBe(true);
  });
});

describe("feedbackSchema", () => {
  it("accepts a valid 1-5 rating", () => {
    expect(
      feedbackSchema.safeParse({ wasResolved: true, rating: 4 }).success
    ).toBe(true);
  });

  it("rejects ratings outside 1-5 and non-integers", () => {
    expect(
      feedbackSchema.safeParse({ wasResolved: true, rating: 0 }).success
    ).toBe(false);
    expect(
      feedbackSchema.safeParse({ wasResolved: true, rating: 6 }).success
    ).toBe(false);
    expect(
      feedbackSchema.safeParse({ wasResolved: true, rating: 3.5 }).success
    ).toBe(false);
  });
});

describe("statusChangeSchema", () => {
  it("requires resolution details when resolving a case", () => {
    const missing = statusChangeSchema.safeParse({
      status: "RESOLVED",
      remarks: "Issue was fully addressed.",
    });
    expect(missing.success).toBe(false);
  });

  it("does not require resolution details for other transitions", () => {
    const moving = statusChangeSchema.safeParse({
      status: "IN_PROGRESS",
      remarks: "Starting investigation.",
    });
    expect(moving.success).toBe(true);
  });
});

const VALID_STATUS_CHANGE = {
  status: "IN_PROGRESS",
  remarks: "Crew dispatched and the pothole is being repaired.",
};

describe("action date on status changes", () => {
  it("accepts a real calendar day", () => {
    const result = statusChangeSchema.safeParse({
      ...VALID_STATUS_CHANGE,
      occurredOn: "2026-09-24",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.occurredOn).toBe("2026-09-24");
  });

  it("treats a blank value as not provided", () => {
    const result = statusChangeSchema.safeParse({
      ...VALID_STATUS_CHANGE,
      occurredOn: "",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.occurredOn).toBeUndefined();
  });

  it("treats a missing value as not provided", () => {
    const result = statusChangeSchema.safeParse(VALID_STATUS_CHANGE);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.occurredOn).toBeUndefined();
  });

  it("rejects malformed, impossible and null dates", () => {
    for (const bad of ["24/09/2026", "2026-09-31", "2026-9-24", null]) {
      expect(
        statusChangeSchema.safeParse({
          ...VALID_STATUS_CHANGE,
          occurredOn: bad,
        } as never).success
      ).toBe(false);
    }
  });
});

describe("caseNoteSchema action date", () => {
  const note = { kind: "REMARK", remarks: "Inspected the site with the crew." };

  it("accepts an optional calendar day", () => {
    expect(
      caseNoteSchema.safeParse({ ...note, occurredOn: "2026-09-22" }).success
    ).toBe(true);
    expect(caseNoteSchema.safeParse(note).success).toBe(true);
  });

  it("rejects an impossible day", () => {
    expect(
      caseNoteSchema.safeParse({ ...note, occurredOn: "2026-02-30" }).success
    ).toBe(false);
  });

  it("treats a blank day as not provided", () => {
    const result = caseNoteSchema.safeParse({ ...note, occurredOn: "" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.occurredOn).toBeUndefined();
  });
});

describe("resolutionSchema.resolvedOn blank handling", () => {
  it("treats a blank resolution date as not provided", () => {
    const result = resolutionSchema.safeParse({
      ...VALID_RESOLUTION,
      resolvedOn: "",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.resolvedOn).toBeUndefined();
  });
});
