import { describe, expect, it } from "vitest";
import {
  allowedTransitions,
  canManageConcern,
  canSubmitFeedback,
  canTransition,
  satisfactionForRating,
  statusLabel,
} from "./workflow";

describe("case workflow transitions", () => {
  it("returns the standard lifecycle", () => {
    expect(allowedTransitions("SUBMITTED")).toEqual(["ASSIGNED"]);
    expect(allowedTransitions("ASSIGNED")).toEqual(["IN_PROGRESS"]);
    expect(allowedTransitions("IN_PROGRESS")).toEqual(["RESOLVED"]);
    expect(allowedTransitions("RESOLVED")).toEqual(["CLOSED"]);
    expect(allowedTransitions("CLOSED")).toEqual([]);
  });

  it("rejects unknown statuses and illegal jumps", () => {
    expect(allowedTransitions("BOGUS")).toEqual([]);
    expect(canTransition("SUBMITTED", "RESOLVED")).toBe(false);
    expect(canTransition("RESOLVED", "IN_PROGRESS")).toBe(false);
    expect(canTransition("CLOSED", "CLOSED")).toBe(false);
    expect(canTransition("SUBMITTED", "ASSIGNED")).toBe(true);
  });
});

describe("canManageConcern", () => {
  it("lets admins act on any concern", () => {
    expect(
      canManageConcern(
        { id: 1, roleKey: "ADMIN", officeId: null },
        { assignedOfficeId: null }
      )
    ).toBe(true);
  });

  it("lets an official act only on their own office's cases", () => {
    expect(
      canManageConcern(
        { id: 2, roleKey: "OFFICIAL", officeId: 5 },
        { assignedOfficeId: 5 }
      )
    ).toBe(true);
    expect(
      canManageConcern(
        { id: 2, roleKey: "OFFICIAL", officeId: 5 },
        { assignedOfficeId: 6 }
      )
    ).toBe(false);
  });

  it("refuses officials without an office and non-official/non-admin roles", () => {
    expect(
      canManageConcern(
        { id: 2, roleKey: "OFFICIAL", officeId: null },
        { assignedOfficeId: null }
      )
    ).toBe(false);
    expect(
      canManageConcern(
        { id: 3, roleKey: "RESIDENT", officeId: null },
        { assignedOfficeId: 5 }
      )
    ).toBe(false);
  });
});

describe("resident feedback rules", () => {
  it("only allows feedback on resolved or closed cases", () => {
    expect(canSubmitFeedback("RESOLVED")).toBe(true);
    expect(canSubmitFeedback("CLOSED")).toBe(true);
    expect(canSubmitFeedback("SUBMITTED")).toBe(false);
    expect(canSubmitFeedback("IN_PROGRESS")).toBe(false);
  });

  it("maps ratings to satisfaction", () => {
    expect(satisfactionForRating(5)).toBe("SATISFIED");
    expect(satisfactionForRating(4)).toBe("SATISFIED");
    expect(satisfactionForRating(3)).toBe("NEUTRAL");
    expect(satisfactionForRating(2)).toBe("DISSATISFIED");
    expect(satisfactionForRating(1)).toBe("DISSATISFIED");
  });
});

describe("statusLabel", () => {
  it("humanizes status keys", () => {
    expect(statusLabel("IN_PROGRESS")).toBe("In Progress");
    expect(statusLabel("PRIORITY_ASSESSED")).toBe("Priority Assessed");
  });
});