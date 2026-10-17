import { describe, expect, it } from "vitest";
import {
  caseProcessFlow,
  crewSatisfied,
  fundingSatisfied,
  roleActsOnProcessStep,
  roleOwnsProcessStep,
  type ProcessFlowInput,
} from "./process-flow";

/** A minimal case: checked, validated, nobody booked yet. */
const base: ProcessFlowInput = {
  status: "ASSIGNED",
  typeId: 4,
  validated: true,
  hasAssessment: false,
  workersNeeded: null,
  estimatedCost: null,
  fundedAmount: 0,
  activeCrew: 0,
  hasResolution: false,
  verificationStatus: null,
  realityCheck: "PASSED",
};

/** A report that just arrived: nobody has been to the location yet. */
const unchecked: ProcessFlowInput = {
  ...base,
  status: "SUBMITTED",
  typeId: null,
  realityCheck: "NONE",
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
    // A saved ₱0 estimate is a statement, not a gap: nothing has to be set aside.
    expect(fundingSatisfied(0, 5000)).toBe(true);
    expect(fundingSatisfied(5000, 0)).toBe(false);
    expect(fundingSatisfied(5000, 4999.99)).toBe(false);
    expect(fundingSatisfied(5000, 5000)).toBe(true);
    expect(fundingSatisfied(5000, 7500)).toBe(true);
    // A saved ₱0 estimate needs nothing set aside.
    expect(fundingSatisfied(0, 0)).toBe(true);
  });
});

describe("caseProcessFlow", () => {
  it("starts every report on the reality check, before anything else", () => {
    const flow = caseProcessFlow(unchecked);
    expect(flow.currentKey).toBe("CHECK");
    expect(flow.currentNumber).toBe(1);
    expect(stepOf(unchecked, "CHECK")).toMatchObject({
      state: "current",
      block: "NEEDS_REALITY_CHECK",
    });
    // Validation cannot get ahead of it: the type is not set *and* the check
    // has not happened, so the wait that matters is the check.
    expect(stepOf(unchecked, "VALIDATE").block).toBe("NEEDS_REALITY_CHECK");
    expect(stepOf(unchecked, "ASSESS").block).toBe("NEEDS_REALITY_CHECK");
    expect(flow.doneCount).toBe(0);
    expect(flow.percent).toBe(0);
  });

  it("holds the case while the check is out, and when a finding is sent back", () => {
    const out = { ...unchecked, realityCheck: "OPEN" as const };
    expect(stepOf(out, "CHECK")).toMatchObject({
      state: "current",
      block: "FIELD_CHECK_OPEN",
    });

    const sentBack = { ...unchecked, realityCheck: "FAILED" as const };
    expect(stepOf(sentBack, "CHECK")).toMatchObject({
      state: "current",
      block: "FIELD_CHECK_FAILED",
    });
    expect(stepOf(sentBack, "VALIDATE").block).toBe("FIELD_CHECK_FAILED");
  });

  it("skips budget and crew on a noise complaint", () => {
    const noise: ProcessFlowInput = {
      ...base,
      status: "ASSIGNED",
      hasAssessment: false,
      workersNeeded: null,
      estimatedCost: null,
      needsCrew: false,
      needsBudget: false,
    };
    expect(stepOf(noise, "FUND").state).toBe("notNeeded");
    expect(stepOf(noise, "CREW").state).toBe("notNeeded");
    expect(caseProcessFlow(noise).currentKey).toBe("ASSESS");
    const planned = { ...noise, hasAssessment: true, status: "UNDER_ASSESSMENT" };
    expect(caseProcessFlow(planned).currentKey).toBe("START");
  });

  it("does not mark Validate done while the field check is still open", () => {
    // A type the resident picked, or an admin who typed the case too early,
    // used to skip Check: the rail said Validate was Done.
    const skipped = {
      ...unchecked,
      typeId: 4,
      realityCheck: "OPEN" as const,
    };
    const flow = caseProcessFlow(skipped);
    expect(flow.currentKey).toBe("CHECK");
    expect(stepOf(skipped, "CHECK").state).toBe("current");
    expect(stepOf(skipped, "VALIDATE")).toMatchObject({
      state: "pending",
      block: "FIELD_CHECK_OPEN",
    });
    expect(flow.doneCount).toBe(0);
  });

  it("moves on to validation once the finding is approved as confirmed", () => {
    const confirmed = {
      ...unchecked,
      validated: false,
      realityCheck: "PASSED" as const,
    };
    const flow = caseProcessFlow(confirmed);
    expect(flow.currentKey).toBe("VALIDATE");
    expect(flow.currentNumber).toBe(2);
    expect(stepOf(confirmed, "CHECK").state).toBe("done");
    expect(stepOf(confirmed, "VALIDATE").block).toBe("NEEDS_TYPE");
  });

  it("does not jump from Check to Assess just because a type was already picked", () => {
    // Filing or routing can fill typeId. That used to mark Validate as Done
    // the moment the site check passed, so the rail skipped step 2.
    const typedAtFiling = {
      ...unchecked,
      status: "ASSIGNED" as const,
      typeId: 4,
      validated: false,
      realityCheck: "PASSED" as const,
    };
    const flow = caseProcessFlow(typedAtFiling);
    expect(flow.currentKey).toBe("VALIDATE");
    expect(flow.currentNumber).toBe(2);
    expect(stepOf(typedAtFiling, "CHECK").state).toBe("done");
    expect(stepOf(typedAtFiling, "VALIDATE")).toMatchObject({
      state: "current",
      block: "NEEDS_TYPE",
    });
    expect(stepOf(typedAtFiling, "ASSESS").state).toBe("pending");
  });

  it("keeps the budget step for every case — nothing is skipped", () => {
    const flow = caseProcessFlow(base);
    const fund = flow.steps.find((step) => step.key === "FUND")!;
    expect(fund.state).toBe("pending");
    expect(fund.block).toBe("NEEDS_ESTIMATE");
    expect(flow.activeTotal).toBe(9);
    expect(flow.steps.some((step) => step.state === "pending")).toBe(true);
  });

  it("moves to the assessment step once the type is set", () => {
    const flow = caseProcessFlow(base);
    expect(flow.currentKey).toBe("ASSESS");
    expect(flow.currentNumber).toBe(3);
    expect(stepOf(base, "ASSESS").block).toBe("NEEDS_ASSESSMENT");
  });

  it("sends the case under assessment before the plan counts", () => {
    const assessed = { ...base, hasAssessment: true, workersNeeded: 3 };
    expect(stepOf(assessed, "ASSESS")).toMatchObject({
      state: "current",
      block: "WAITING_UNDER_ASSESSMENT",
    });
    const under = caseProcessFlow({ ...assessed, status: "UNDER_ASSESSMENT" });
    // The money step comes next: every case passes through it.
    expect(under.currentKey).toBe("FUND");
    expect(under.currentNumber).toBe(4);
  });

  it("waits for the treasury on every case", () => {
    const money = {
      ...base,
      status: "UNDER_ASSESSMENT",
      hasAssessment: true,
      workersNeeded: 2,
      estimatedCost: 12_000,
      activeCrew: 2,
    };
    const flow = caseProcessFlow(money);
    expect(flow.currentKey).toBe("FUND");
    expect(flow.currentNumber).toBe(4);
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
      estimatedCost: 3000,
      fundedAmount: 3000,
    };
    expect(stepOf(short, "CREW").block).toBe("NEEDS_CREW");
    expect(stepOf(short, "START").block).toBe("NEEDS_CREW");
    expect(caseProcessFlow(short).currentKey).toBe("CREW");
  });

  it("keeps a case whose check never passed from starting work", () => {
    const held = {
      ...base,
      status: "UNDER_ASSESSMENT",
      hasAssessment: true,
      workersNeeded: 1,
      activeCrew: 1,
      realityCheck: "FAILED" as const,
    };
    expect(stepOf(held, "START").block).toBe("FIELD_CHECK_FAILED");
  });

  it("walks a case all the way to closed", () => {
    const inProgress = {
      ...base,
      status: "IN_PROGRESS",
      hasAssessment: true,
      workersNeeded: 2,
      estimatedCost: 8000,
      fundedAmount: 8000,
      activeCrew: 2,
    };
    const working = caseProcessFlow(inProgress);
    expect(working.currentKey).toBe("WORK");
    expect(working.currentNumber).toBe(7);
    expect(working.steps.slice(0, 6).every((step) => step.state === "done")).toBe(
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
    expect(toVerify.currentNumber).toBe(8);
    expect(stepOf(resolved, "CLOSE").block).toBe("NEEDS_VERIFICATION");

    const verified = { ...resolved, verificationStatus: "FIXED_VERIFIED" };
    const toClose = caseProcessFlow(verified);
    expect(toClose.currentKey).toBe("CLOSE");
    expect(toClose.currentNumber).toBe(9);
    expect(stepOf(verified, "CLOSE").block).toBeNull();

    const closed = { ...verified, status: "CLOSED" };
    const done = caseProcessFlow(closed);
    expect(done.finished).toBe(true);
    expect(done.currentKey).toBeNull();
    expect(done.percent).toBe(100);
    expect(done.doneCount).toBe(done.activeTotal);
  });

  it("drops the steps a closed-as-unfounded case never reached", () => {
    // A field check that was approved as "not confirmed" closes the case from
    // ASSIGNED (see closeAsUnfounded): no assessment, no money, no crew, no
    // work ever happened, so those steps are not "done" and not "coming".
    const unfounded: ProcessFlowInput = {
      ...base,
      status: "CLOSED",
      typeId: 4,
      hasAssessment: false,
      workersNeeded: null,
      estimatedCost: null,
      fundedAmount: 0,
      activeCrew: 0,
      hasResolution: false,
      verificationStatus: null,
      // The check did happen: it is what ended the case.
      realityCheck: "FAILED",
    };
    const flow = caseProcessFlow(unfounded);
    expect(flow.finished).toBe(true);
    expect(flow.currentKey).toBeNull();
    expect(stepOf(unfounded, "CHECK").state).toBe("done");
    expect(stepOf(unfounded, "VALIDATE").state).toBe("done");
    expect(stepOf(unfounded, "CLOSE").state).toBe("done");
    for (const key of ["ASSESS", "FUND", "CREW", "START", "WORK", "VERIFY"]) {
      expect(stepOf(unfounded, key)).toMatchObject({ state: "notNeeded", block: null });
    }
    // Only the steps that happened count towards the progress.
    expect(flow.activeTotal).toBe(3);
    expect(flow.doneCount).toBe(3);
    expect(flow.percent).toBe(100);
    expect(flow.closedUnfounded).toBe(true);
  });

  it("never leaves a current step on a closed case", () => {
    // Closed on a reasoned status-force override, with the verification still
    // outstanding: the case is finished, so the leftover step is not "coming".
    const forced = {
      ...base,
      status: "CLOSED",
      hasAssessment: true,
      workersNeeded: 1,
      estimatedCost: 1000,
      fundedAmount: 1000,
      activeCrew: 1,
      hasResolution: true,
      verificationStatus: "FAILED",
    };
    const flow = caseProcessFlow(forced);
    expect(flow.currentKey).toBeNull();
    expect(flow.finished).toBe(true);
    expect(flow.closedUnfounded).toBe(false);
    expect(stepOf(forced, "VERIFY").state).toBe("notNeeded");
    expect(flow.steps.every((step) => step.state !== "current")).toBe(true);
  });

  it("flags a failed verification instead of letting the case close", () => {
    const failed = {
      ...base,
      status: "RESOLVED",
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

  it("reports progress as a share of all nine steps", () => {
    const flow = caseProcessFlow({
      ...base,
      status: "IN_PROGRESS",
      hasAssessment: true,
      workersNeeded: 1,
      activeCrew: 1,
      estimatedCost: 500,
      fundedAmount: 500,
    });
    // CHECK, VALIDATE, ASSESS, FUND, CREW, START = 6 of 9.
    expect(flow.activeTotal).toBe(9);
    expect(flow.doneCount).toBe(6);
    expect(flow.percent).toBe(67);
  });
});

describe("roleOwnsProcessStep", () => {
  it("gives admin only the site-check review and validation", () => {
    expect(roleOwnsProcessStep("ADMIN", "CHECK")).toBe(true);
    expect(roleOwnsProcessStep("ADMIN", "VALIDATE")).toBe(true);
    expect(roleOwnsProcessStep("ADMIN", "ASSESS")).toBe(false);
    expect(roleOwnsProcessStep("ADMIN", "CLOSE")).toBe(false);
  });

  it("gives the assigned official the work after validation", () => {
    expect(roleOwnsProcessStep("OFFICIAL", "VALIDATE")).toBe(false);
    expect(roleOwnsProcessStep("OFFICIAL", "ASSESS")).toBe(true);
    expect(roleOwnsProcessStep("OFFICIAL", "CREW")).toBe(true);
    expect(roleOwnsProcessStep("OFFICIAL", "CLOSE")).toBe(false);
  });

  it("splits the budget step: official sends it, treasurer and captain fund it", () => {
    expect(
      roleActsOnProcessStep("OFFICIAL", "FUND", { block: "WAITING_BUDGET_STAGE" })
    ).toBe(true);
    expect(roleActsOnProcessStep("OFFICIAL", "FUND", { block: "NEEDS_FUNDS" })).toBe(
      false
    );
    expect(
      roleActsOnProcessStep("TREASURER", "FUND", { block: "NEEDS_FUNDS" })
    ).toBe(true);
    expect(
      roleActsOnProcessStep("ADMIN", "FUND", { block: "NEEDS_FUNDS" })
    ).toBe(false);
  });

  it("does not let the official who recorded the fix verify it", () => {
    expect(
      roleActsOnProcessStep("OFFICIAL", "VERIFY", { verifySelfRecorded: true })
    ).toBe(false);
    expect(
      roleActsOnProcessStep("CAPTAIN", "VERIFY", { verifySelfRecorded: true })
    ).toBe(true);
  });
});
