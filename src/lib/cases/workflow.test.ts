import { describe, expect, it } from "vitest";
import {
  allowedTransitions,
  canCloseConcern,
  canManageConcern,
  canSubmitFeedback,
  canTransition,
  caseWorkflowFlags,
  budgetStageBlock,
  CREATABLE_OVERRIDE_KINDS,
  isCloseableVerification,
  isPassingVerification,
  OVERRIDE_KINDS,
  overrideLabel,
  satisfactionForRating,
  statusLabel,
  statusPermissionFor,
} from "./workflow";

describe("case workflow transitions", () => {
  it("returns the seven-stage lifecycle", () => {
    expect(allowedTransitions("SUBMITTED")).toEqual(["ASSIGNED"]);
    expect(allowedTransitions("ASSIGNED")).toEqual(["UNDER_ASSESSMENT"]);
    // The transition exists, but the money gate refuses it for every case.
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

  describe("budgetStageBlock (no case skips AWAITING_BUDGET)", () => {
    const base = { estimatedCost: 5000, fundedAmount: 5000 };

    it("blocks money cases from skipping straight to IN_PROGRESS, with no override", () => {
      expect(
        budgetStageBlock({ ...base, fromStatus: "UNDER_ASSESSMENT", toStatus: "IN_PROGRESS" })
      ).toMatch(/cannot skip/);
      expect(
        budgetStageBlock({
          fromStatus: "UNDER_ASSESSMENT",
          toStatus: "IN_PROGRESS",
          estimatedCost: null,
          fundedAmount: 0,
        })
      ).toMatch(/cannot skip/);
      // A case that costs nothing never enters the budget stage.
      expect(
        budgetStageBlock({
          fromStatus: "UNDER_ASSESSMENT",
          toStatus: "IN_PROGRESS",
          estimatedCost: 0,
          fundedAmount: 0,
        })
      ).toBeNull();
    });

    it("needs a saved cost estimate before the case starts waiting for budget", () => {
      expect(
        budgetStageBlock({ ...base, estimatedCost: null, fromStatus: "UNDER_ASSESSMENT", toStatus: "AWAITING_BUDGET" })
      ).toMatch(/cost estimate/);
      expect(
        budgetStageBlock({ ...base, fromStatus: "UNDER_ASSESSMENT", toStatus: "AWAITING_BUDGET" })
      ).toBeNull();
      // A saved ₱0 estimate is an answer: the case costs nothing.
      expect(
        budgetStageBlock({
          fromStatus: "UNDER_ASSESSMENT",
          toStatus: "AWAITING_BUDGET",
          estimatedCost: 0,
          fundedAmount: 0,
        })
      ).toBeNull();
    });

    it("needs approved funds that cover the estimate before work starts", () => {
      const short = budgetStageBlock({
        ...base,
        fundedAmount: 3000,
        fromStatus: "AWAITING_BUDGET",
        toStatus: "IN_PROGRESS",
      });
      expect(short).toMatch(/Only ₱3,000\.00 is set aside/);
      expect(short).toMatch(/₱5,000\.00/);
      expect(
        budgetStageBlock({ ...base, fundedAmount: 0, fromStatus: "AWAITING_BUDGET", toStatus: "IN_PROGRESS" })
      ).toMatch(/set aside/);
      expect(
        budgetStageBlock({ ...base, fundedAmount: 5000, fromStatus: "AWAITING_BUDGET", toStatus: "IN_PROGRESS" })
      ).toBeNull();
    });

    it("blocks AWAITING_BUDGET and IN_PROGRESS while a required assessment approval is pending", () => {
      expect(
        budgetStageBlock({
          ...base,
          fromStatus: "UNDER_ASSESSMENT",
          toStatus: "AWAITING_BUDGET",
          assessmentApprovalPending: true,
        })
      ).toMatch(/requires approval/);
      expect(
        budgetStageBlock({
          ...base,
          fromStatus: "AWAITING_BUDGET",
          toStatus: "IN_PROGRESS",
          assessmentApprovalPending: true,
        })
      ).toMatch(/requires approval/);
      // The zero-cost shortcut from UNDER_ASSESSMENT straight to IN_PROGRESS
      // is blocked too — a pending approval cannot be dodged by a ₱0 estimate.
      expect(
        budgetStageBlock({
          fromStatus: "UNDER_ASSESSMENT",
          toStatus: "IN_PROGRESS",
          estimatedCost: 0,
          fundedAmount: 0,
          assessmentApprovalPending: true,
        })
      ).toMatch(/requires approval/);
      // Once approved (the flag is false/absent), the normal rules apply again.
      expect(
        budgetStageBlock({ ...base, fromStatus: "UNDER_ASSESSMENT", toStatus: "AWAITING_BUDGET" })
      ).toBeNull();
    });

    it("the retired skip kind can no longer be created, but still reads", () => {
      expect(CREATABLE_OVERRIDE_KINDS).not.toContain("BUDGET_STAGE_SKIP");
      expect(OVERRIDE_KINDS).not.toContain("BUDGET_STAGE_SKIP");
      expect(overrideLabel("BUDGET_STAGE_SKIP")).toMatch(/no longer allowed/);
      expect(overrideLabel("CREW_SHORTFALL")).toMatch(/fewer crew/);
      expect(overrideLabel("SOMETHING_ELSE")).toBe("SOMETHING_ELSE");
    });

    it("re-checks funding before a case is marked resolved, with no override", () => {
      const drifted = budgetStageBlock({
        fromStatus: "IN_PROGRESS",
        toStatus: "RESOLVED",
        estimatedCost: 7000,
        fundedAmount: 5000,
      });
      expect(drifted).toMatch(/Crew changes/);
      expect(drifted).toMatch(/₱7,000\.00/);
      expect(drifted).toMatch(/₱5,000\.00/);

      expect(
        budgetStageBlock({
          fromStatus: "IN_PROGRESS",
          toStatus: "RESOLVED",
          estimatedCost: 5000,
          fundedAmount: 5000,
        })
      ).toBeNull();

      expect(
        budgetStageBlock({
          fromStatus: "IN_PROGRESS",
          toStatus: "RESOLVED",
          estimatedCost: 0,
          fundedAmount: 0,
        })
      ).toBeNull();

      expect(
        budgetStageBlock({
          fromStatus: "IN_PROGRESS",
          toStatus: "RESOLVED",
          estimatedCost: null,
          fundedAmount: 0,
        })
      ).toBeNull();
    });
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

  it("treats a fixed or partial check as the verification step being worked", () => {
    expect(isPassingVerification("FIXED_VERIFIED")).toBe(true);
    expect(isPassingVerification("PARTIALLY_VERIFIED")).toBe(true);
    expect(isPassingVerification("FAILED")).toBe(false);
    expect(isPassingVerification("PENDING_RESIDENT_CONFIRMATION")).toBe(false);
    expect(isPassingVerification("PENDING")).toBe(false);
    expect(isPassingVerification(null)).toBe(false);
  });

  it("closes only on a fully fixed verification, never on a partial one", () => {
    expect(isCloseableVerification("FIXED_VERIFIED")).toBe(true);
    // A partially verified fix is still an open problem: the case stays open.
    expect(isCloseableVerification("PARTIALLY_VERIFIED")).toBe(false);
    expect(isCloseableVerification("FAILED")).toBe(false);
    expect(isCloseableVerification("PENDING_RESIDENT_CONFIRMATION")).toBe(false);
    expect(isCloseableVerification("PENDING")).toBe(false);
    expect(isCloseableVerification(null)).toBe(false);
  });
});
