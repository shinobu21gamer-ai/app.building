import { describe, expect, it } from "vitest";
import {
  allowedTransitions,
  canCloseConcern,
  canManageConcern,
  canSubmitFeedback,
  canTransition,
  caseWorkflowFlags,
  requiresBudgetSkipOverride,
  satisfactionForRating,
  statusLabel,
  statusPermissionFor,
} from "./workflow";

describe("case workflow transitions", () => {
  it("returns the seven-stage lifecycle", () => {
    expect(allowedTransitions("SUBMITTED")).toEqual(["ASSIGNED"]);
    expect(allowedTransitions("ASSIGNED")).toEqual(["UNDER_ASSESSMENT"]);
    // AWAITING_BUDGET is skippable: assessment may go straight to work.
    expect(allowedTransitions("UNDER_ASSESSMENT")).toEqual([
      "AWAITING_BUDGET",
      "IN_PROGRESS",
    ]);
    expect(allowedTransitions("AWAITING_BUDGET")).toEqual(["IN_PROGRESS"]);
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
    expect(canTransition("SUBMITTED", "IN_PROGRESS")).toBe(false);
    expect(canTransition("ASSIGNED", "IN_PROGRESS")).toBe(false);
  });

  it("maps a target status to the permission it needs", () => {
    expect(statusPermissionFor("UNDER_ASSESSMENT")).toBe("case.status.progress");
    expect(statusPermissionFor("IN_PROGRESS")).toBe("case.status.progress");
    expect(statusPermissionFor("RESOLVED")).toBe("case.status.progress");
    expect(statusPermissionFor("CLOSED")).toBe("case.status.close");
    expect(statusPermissionFor("SUBMITTED")).toBeNull();
  });

  it("demands an override only when a funded case skips the budget stage", () => {
    expect(
      requiresBudgetSkipOverride({
        fromStatus: "UNDER_ASSESSMENT",
        toStatus: "IN_PROGRESS",
        typeRequiresBudget: true,
      })
    ).toBe(true);
    expect(
      requiresBudgetSkipOverride({
        fromStatus: "UNDER_ASSESSMENT",
        toStatus: "IN_PROGRESS",
        typeRequiresBudget: false,
      })
    ).toBe(false);
    expect(
      requiresBudgetSkipOverride({
        fromStatus: "AWAITING_BUDGET",
        toStatus: "IN_PROGRESS",
        typeRequiresBudget: true,
      })
    ).toBe(false);
  });
});

describe("case workflow flags", () => {
  it("flags a legacy open case with no plan and keeps it ungated", () => {
    const flags = caseWorkflowFlags({
      status: "ASSIGNED",
      workersNeeded: null,
      activeCrew: 0,
    });
    expect(flags.legacy).toBe(true);
    expect(flags.crewSatisfied).toBe(true);
    expect(flags.crewProgressLabel).toBe("0 assigned");
  });

  it("reports progress against the plan once one exists", () => {
    const flags = caseWorkflowFlags({
      status: "UNDER_ASSESSMENT",
      workersNeeded: 3,
      activeCrew: 2,
    });
    expect(flags.legacy).toBe(false);
    expect(flags.crewSatisfied).toBe(false);
    expect(flags.crewProgressLabel).toBe("2 of 3 assigned");
  });

  it("does not call a finished case legacy", () => {
    expect(
      caseWorkflowFlags({ status: "CLOSED", workersNeeded: null, activeCrew: 4 })
        .legacy
    ).toBe(false);
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

describe("canCloseConcern", () => {
  it("closing belongs to the approving official", () => {
    expect(canCloseConcern({ id: 1, roleKey: "CAPTAIN", officeId: null })).toBe(true);
    expect(canCloseConcern({ id: 1, roleKey: "ADMIN", officeId: null })).toBe(true);
    expect(canCloseConcern({ id: 1, roleKey: "OFFICIAL", officeId: 5 })).toBe(false);
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