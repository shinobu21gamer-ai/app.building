import { describe, expect, it } from "vitest";
import {
  canRequestFieldCheck,
  fieldCheckGateBlock,
  findingProblem,
} from "./field-check-rules";

describe("fieldCheckGateBlock", () => {
  it("does not gate a case when no check was requested", () => {
    expect(fieldCheckGateBlock([])).toBeNull();
  });

  it("blocks while a check is pending or awaiting admin review", () => {
    expect(fieldCheckGateBlock([{ status: "PENDING", finding: null }])).toMatch(/still open/);
    expect(fieldCheckGateBlock([{ status: "SUBMITTED", finding: "CONFIRMED" }])).toMatch(/still open/);
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
});

describe("findingProblem", () => {
  it("accepts a confirmed finding with no notes or photo", () => {
    expect(findingProblem({ finding: "CONFIRMED", notes: null, hasPhoto: false })).toBeNull();
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

  it("requires a reason for cannot-verify", () => {
    expect(findingProblem({ finding: "CANNOT_VERIFY", notes: "", hasPhoto: false })).toMatch(/could not be verified/);
  });
});

describe("canRequestFieldCheck", () => {
  it("is allowed only while the case is ASSIGNED, before assessment starts", () => {
    expect(canRequestFieldCheck("ASSIGNED")).toBe(true);
    expect(canRequestFieldCheck("UNDER_ASSESSMENT")).toBe(false);
    expect(canRequestFieldCheck("SUBMITTED")).toBe(false);
  });
});
