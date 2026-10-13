import { describe, expect, it } from "vitest";
import {
  caseProcessFlow,
  crewSatisfied,
  fundingSatisfied,
  type ProcessFlowInput,
} from "./process-flow";

/** A minimal case: submitted, validated, no money needed, nobody booked yet. */
const base: ProcessFlowInput = {
  status: "ASSIGNED",
  typeId: 4,
  requiresBudget: false,
  hasAssessment: false,
  workersNeeded: null,
  estimatedCost: null,
  fundedAmount: 0,
  activeCrew: 0,
  hasResolution: false,
  verificationStatus: null,
  fieldCheckOpen: false,
};

const stepOf = (input: ProcessFlowInput, key: string) =>
  caseProcessFlow(input).steps.find((step) => step.key === key)!;

describe("crewSatisfied", () => {
  it("needs a plan to be staffed", () => {
    expect(crewSatisfied(null, 0)).toBe(false);
    expect(crewSatisfied(null, 1)).toBe(true);
    expect(crewSatisfied(3, 2)).toBe(false);
    expect(crewSatisfied(3, 3)).toBe(true);
  });
});

describe("fundingSatisfied", () => {
  it("needs an estimate the earmarks cover", () => {
    expect(fundingSatisfied(null, 5000)).toBe(false);
    expect(fundingSatisfied(0, 5000)).toBe(false);
    expect(fundingSatisfied(5000, 0)).toBe(false);
    expect(fundingSatisfied(5000, 4999.99)).toBe(false);
    expect(fundingSatisfied(5000, 5000)).toBe(true);
    expect(fundingSatisfied(5000, 7500)).toBe(true);
  });
});

describe("caseProcessFlow", () => {
  it("starts an unvalidated report on step 1", () => {
    const flow = caseProcessFlow({ ...base, status: "SUBMITTED", typeId: null });
    expect(flow.currentKey).toBe("VALIDATE");
    expect(flow.currentNumber).toBe(1);
    expect(stepOf({ ...base, status: "SUBMITTED", typeId: null }, "VALIDATE")).toMatchObject({
      state: "current",
      block: "NEEDS_TYPE",
    });
    expect(flow.doneCount).toBe(0);
    expect(flow.percent).toBe(0);
  });

  it("skips the budget step for a case that needs no money", () => {
    const flow = caseProcessFlow(base);
    const fund = flow.steps.find((step) => step.key === "FUND")!;
    expect(fund.state).toBe("skipped");
    // 8 steps, one of them skipped → progress is out of 7.
    expect(flow.activeTotal).toBe(7);
  });

  it("moves to the assessment step once the type is set", () => {
    const flow = caseProcessFlow(base);
    expect(flow.currentKey).toBe("ASSESS");
    expect(flow.currentNumber).toBe(2);
    expect(stepOf(base, "ASSESS").block).toBe("NEEDS_ASSESSMENT");
  });

  it("sends the case under assessment before the plan counts", () => {
    const assessed = { ...base, hasAssessment: true, workersNeeded: 3 };
    expect(stepOf(assessed, "ASSESS")).toMatchObject({
      state: "current",
      block: "WAITING_UNDER_ASSESSMENT",
    });
    const under = caseProcessFlow({ ...assessed, status: "UNDER_ASSESSMENT" });
    expect(under.currentKey).toBe("CREW");
    expect(under.currentNumber).toBe(4);
  });

  it("waits for the treasury on a money case", () => {
    const money = {
      ...base,
      status: "UNDER_ASSESSMENT",
      requiresBudget: true,
      hasAssessment: true,
      workersNeeded: 2,
      estimatedCost: 12_000,
      activeCrew: 2,
    };
    const flow = caseProcessFlow(money);
    expect(flow.currentKey).toBe("FUND");
    expect(flow.currentNumber).toBe(3);
    expect(stepOf(money, "FUND").block).toBe("WAITING_BUDGET_STAGE");
    expect(stepOf(money, "START").block).toBe("WAITING_BUDGET_STAGE");

    const waiting = { ...money, status: "AWAITING_BUDGET" };
    expect(stepOf(waiting, "FUND").block).toBe("NEEDS_FUNDS");
    expect(stepOf(waiting, "START").block).toBe("NEEDS_FUNDS");

    const funded = { ...waiting, fundedAmount: 12_000 };
    expect(stepOf(funded, "FUND").state).toBe("done");
    expect(caseProcessFlow(funded).currentKey).toBe("START");
  });

  it("will not start work without the planned crew", () => {
    const short = {
      ...base,
      status: "UNDER_ASSESSMENT",
      hasAssessment: true,
      workersNeeded: 3,
      activeCrew: 1,
    };
    expect(stepOf(short, "CREW").block).toBe("NEEDS_CREW");
    expect(stepOf(short, "START").block).toBe("NEEDS_CREW");
    expect(caseProcessFlow(short).currentKey).toBe("CREW");
  });

  it("pauses on an open field check", () => {
    const held = {
      ...base,
      status: "UNDER_ASSESSMENT",
      hasAssessment: true,
      workersNeeded: 1,
      activeCrew: 1,
      fieldCheckOpen: true,
    };
    expect(stepOf(held, "START").block).toBe("FIELD_CHECK_OPEN");
  });

  it("walks a money case all the way to closed", () => {
    const inProgress = {
      ...base,
      status: "IN_PROGRESS",
      requiresBudget: true,
      hasAssessment: true,
      workersNeeded: 2,
      estimatedCost: 8000,
      fundedAmount: 8000,
      activeCrew: 2,
    };
    const working = caseProcessFlow(inProgress);
    expect(working.currentKey).toBe("WORK");
    expect(working.currentNumber).toBe(6);
    expect(working.steps.slice(0, 5).every((step) => step.state === "done")).toBe(
      true
    );

    const resolved = {
      ...inProgress,
      status: "RESOLVED",
      hasResolution: true,
      verificationStatus: "PENDING",
    };
    const toVerify = caseProcessFlow(resolved);
    expect(toVerify.currentKey).toBe("VERIFY");
    expect(toVerify.currentNumber).toBe(7);
    expect(stepOf(resolved, "CLOSE").block).toBe("NEEDS_VERIFICATION");

    const verified = { ...resolved, verificationStatus: "FIXED_VERIFIED" };
    const toClose = caseProcessFlow(verified);
    expect(toClose.currentKey).toBe("CLOSE");
    expect(toClose.currentNumber).toBe(8);
    expect(stepOf(verified, "CLOSE").block).toBeNull();

    const closed = { ...verified, status: "CLOSED" };
    const done = caseProcessFlow(closed);
    expect(done.finished).toBe(true);
    expect(done.currentKey).toBeNull();
    expect(done.percent).toBe(100);
    expect(done.doneCount).toBe(done.activeTotal);
  });

  it("flags a failed verification instead of letting the case close", () => {
    const failed = {
      ...base,
      status: "RESOLVED",
      requiresBudget: true,
      hasAssessment: true,
      workersNeeded: 1,
      estimatedCost: 1000,
      fundedAmount: 1000,
      activeCrew: 1,
      hasResolution: true,
      verificationStatus: "FAILED",
    };
    expect(stepOf(failed, "VERIFY")).toMatchObject({
      state: "current",
      block: "VERIFICATION_FAILED",
    });
    expect(stepOf(failed, "CLOSE").block).toBe("NEEDS_VERIFICATION");
  });

  it("guides a legacy case with no plan to the assessment instead of the crew", () => {
    const legacy = { ...base, status: "ASSIGNED", workersNeeded: null };
    expect(caseProcessFlow(legacy).currentKey).toBe("ASSESS");
    expect(stepOf(legacy, "CREW").block).toBe("NEEDS_CREW_PLAN");
    expect(stepOf(legacy, "START").block).toBe("NEEDS_ASSESSMENT");
  });

  it("reports progress as a share of the steps that apply", () => {
    const flow = caseProcessFlow({
      ...base,
      status: "IN_PROGRESS",
      hasAssessment: true,
      workersNeeded: 1,
      activeCrew: 1,
    });
    // VALIDATE, ASSESS, CREW, START = 4 of 7 (FUND is skipped).
    expect(flow.activeTotal).toBe(7);
    expect(flow.doneCount).toBe(4);
    expect(flow.percent).toBe(57);
  });
});
