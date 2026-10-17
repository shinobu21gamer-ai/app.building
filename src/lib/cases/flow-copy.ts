import { copy, type Locale } from "@/lib/i18n";
import type { ProcessStepKey } from "@/lib/cases/process-flow";

/** One locale's per-step copy. CHECK and FUND add role-specific lists. */
export type FlowCopySteps = (typeof copy)[Locale]["flow"]["steps"];

/**
 * The checklist for this reader. TypeScript cannot see `todoAdmin` on a
 * union of every step, so the key is narrowed before those fields are read
 * (that access is what broke the Vercel build).
 */
export function flowStepTodo(
  steps: FlowCopySteps,
  key: ProcessStepKey,
  role: string
): string[] {
  if (key === "CHECK") {
    return role === "ADMIN" ? [...steps.CHECK.todoAdmin] : [...steps.CHECK.todoOfficial];
  }
  if (key === "FUND") {
    if (role === "CAPTAIN") return [...steps.FUND.todoCaptain];
    if (role === "TREASURER") return [...steps.FUND.todoTreasury];
    return [...steps.FUND.todoOfficial];
  }
  return [...steps[key].todo];
}

/** Who-does-this sentence, with FUND split between the case official and money desks. */
export function flowStepWho(
  steps: FlowCopySteps,
  key: ProcessStepKey,
  role: string
): string {
  if (key === "FUND") {
    return role === "OFFICIAL" ? steps.FUND.whoOfficial : steps.FUND.whoMoney;
  }
  return steps[key].who;
}

/** Steps whose card must name the official who holds the case. */
export function stepNamesOfficial(key: ProcessStepKey): boolean {
  return key === "ASSESS" || key === "CREW" || key === "START" || key === "WORK";
}

/** True when this role's case work is assigned to another named official. */
export function assignedOfficialIsOther(input: {
  role: string;
  key: ProcessStepKey;
  userId: number;
  assignedOfficialId: number | null;
}): boolean {
  return (
    input.role === "OFFICIAL" &&
    stepNamesOfficial(input.key) &&
    input.assignedOfficialId !== null &&
    input.assignedOfficialId !== input.userId
  );
}
