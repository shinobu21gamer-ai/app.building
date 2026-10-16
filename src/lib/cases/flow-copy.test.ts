import { describe, expect, it } from "vitest";
import { copy } from "@/lib/i18n";
import { flowStepTodo, flowStepWho, stepNamesOfficial } from "./flow-copy";

const steps = copy.en.flow.steps;

describe("flowStepTodo", () => {
  it("uses the admin checklist on CHECK, not a field that every step has", () => {
    expect(flowStepTodo(steps, "CHECK", "ADMIN")).toEqual(steps.CHECK.todoAdmin);
    expect(flowStepTodo(steps, "CHECK", "OFFICIAL")).toEqual(steps.CHECK.todoOfficial);
  });

  it("splits FUND by money desk", () => {
    expect(flowStepTodo(steps, "FUND", "CAPTAIN")).toEqual(steps.FUND.todoCaptain);
    expect(flowStepTodo(steps, "FUND", "TREASURER")).toEqual(steps.FUND.todoTreasury);
    expect(flowStepTodo(steps, "FUND", "OFFICIAL")).toEqual(steps.FUND.todoOfficial);
  });

  it("uses the shared list on Assess", () => {
    expect(flowStepTodo(steps, "ASSESS", "OFFICIAL")).toEqual(steps.ASSESS.todo);
  });
});

describe("flowStepWho", () => {
  it("names the money desks on FUND unless the reader is the case official", () => {
    expect(flowStepWho(steps, "FUND", "OFFICIAL")).toBe(steps.FUND.whoOfficial);
    expect(flowStepWho(steps, "FUND", "CAPTAIN")).toBe(steps.FUND.whoMoney);
    expect(flowStepWho(steps, "ASSESS", "ADMIN")).toBe(steps.ASSESS.who);
  });
});

describe("stepNamesOfficial", () => {
  it("names the person on the official's work steps", () => {
    expect(stepNamesOfficial("ASSESS")).toBe(true);
    expect(stepNamesOfficial("VALIDATE")).toBe(false);
  });
});
