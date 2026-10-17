import { describe, expect, it } from "vitest";
import {
  canRequestFieldCheck,
  canReplyToFieldCheck,
  fieldCheckGateBlock,
  findingProblem,
  realityCheckState,
} from "./field-check-rules";

describe("realityCheckState", () => {
  it("is NONE until somebody is sent", () => {
    expect(realityCheckState([])).toBe("NONE");
  });

  it("is OPEN while a check is out or waiting for the admin", () => {
    expect(realityCheckState([{ status: "PENDING", finding: null }])).toBe("OPEN");
    expect(realityCheckState([{ status: "SUBMITTED", finding: "CONFIRMED" }])).toBe("OPEN");
    expect(
      realityCheckState([
        { status: "APPROVED", finding: "CANNOT_VERIFY" },
        { status: "PENDING", finding: null },
      ])
    ).toBe("OPEN");
  });

  it("is PASSED once an approved finding confirms the report", () => {
    expect(
      realityCheckState([
        { status: "APPROVED", finding: "CANNOT_VERIFY" },
        { status: "APPROVED", finding: "CONFIRMED" },
      ])
    ).toBe("PASSED");
  });

  it("is FAILED when the approved findings did not confirm it", () => {
    expect(realityCheckState([{ status: "APPROVED", finding: "CANNOT_VERIFY" }])).toBe("FAILED");
    expect(realityCheckState([{ status: "APPROVED", finding: "NOT_CONFIRMED" }])).toBe("FAILED");
  });

  it("counts a case already past this point as passed (legacy)", () => {
    expect(realityCheckState([], { legacyPassed: true })).toBe("PASSED");
  });
});

describe("fieldCheckGateBlock", () => {
  it("blocks a case nobody has checked yet", () => {
    expect(fieldCheckGateBlock([])).toMatch(/Nobody has checked the location/);
  });

  it("blocks while a check is pending or awaiting admin review", () => {
    expect(fieldCheckGateBlock([{ status: "PENDING", finding: null }])).toMatch(/still open|field check is open/i);
    expect(fieldCheckGateBlock([{ status: "SUBMITTED", finding: "CONFIRMED" }])).toMatch(/field check is open/i);
  });

  it("passes once an approved check confirms the concern", () => {
    expect(
      fieldCheckGateBlock([
        { status: "APPROVED", finding: "CANNOT_VERIFY" },
        { status: "APPROVED", finding: "CONFIRMED" },
      ])
    ).toBeNull();
  });

  it("blocks when the only approved finding could not verify the concern", () => {
    expect(fieldCheckGateBlock([{ status: "APPROVED", finding: "CANNOT_VERIFY" }])).toMatch(
      /did not confirm/
    );
  });

  it("lets a legacy case through when its stage says so", () => {
    expect(fieldCheckGateBlock([], { legacyPassed: true })).toBeNull();
  });
});

describe("findingProblem", () => {
  it("rejects a confirmed finding with no photo", () => {
    expect(findingProblem({ finding: "CONFIRMED", notes: null, hasPhoto: false })).toMatch(/photo/);
  });

  it("accepts a confirmed finding with a photo and no notes", () => {
    expect(findingProblem({ finding: "CONFIRMED", notes: null, hasPhoto: true })).toBeNull();
  });

  it("requires notes and a photo for a not-confirmed finding", () => {
    expect(findingProblem({ finding: "NOT_CONFIRMED", notes: "short", hasPhoto: true })).toMatch(/at least 10/);
    expect(
      findingProblem({ finding: "NOT_CONFIRMED", notes: "Nothing at the site, checked twice", hasPhoto: false })
    ).toMatch(/photo/);
    expect(
      findingProblem({ finding: "NOT_CONFIRMED", notes: "Nothing at the site, checked twice", hasPhoto: true })
    ).toBeNull();
  });

  it("requires a reason and a photo for cannot-verify", () => {
    expect(findingProblem({ finding: "CANNOT_VERIFY", notes: "", hasPhoto: true })).toMatch(/could not be verified/);
    expect(
      findingProblem({ finding: "CANNOT_VERIFY", notes: "Gate was locked, no view of the site", hasPhoto: false })
    ).toMatch(/photo/);
  });
});

describe("canReplyToFieldCheck", () => {
  it("allows a resident reply while the check is open or waiting for review", () => {
    expect(canReplyToFieldCheck("PENDING")).toBe(true);
    expect(canReplyToFieldCheck("SUBMITTED")).toBe(true);
  });

  it("does not allow new replies after the check is approved", () => {
    expect(canReplyToFieldCheck("APPROVED")).toBe(false);
  });
});

describe("canRequestFieldCheck", () => {
  it("is allowed on a fresh report and while it is still assigned", () => {
    expect(canRequestFieldCheck("ASSIGNED")).toBe(true);
    expect(canRequestFieldCheck("UNDER_ASSESSMENT")).toBe(false);
    expect(canRequestFieldCheck("SUBMITTED")).toBe(true);
  });
});
