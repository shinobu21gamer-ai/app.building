import { describe, expect, it } from "vitest";
import {
  SLA_DEFAULT_HOURS,
  escalationDedupeKey,
  escalationLevelFor,
  escalationLevelLabel,
  hoursBetween,
  isSlaOpenStage,
  policySpecificity,
  recipientRoles,
  resolveSlaPolicy,
  resolveSlaWindow,
  slaDueAt,
  summarizeEscalations,
  type SlaPolicyLike,
} from "./policy";

function policy(overrides: Partial<SlaPolicyLike> & { id: number }): SlaPolicyLike {
  return {
    key: `policy-${overrides.id}`,
    name: `Policy ${overrides.id}`,
    stage: "ASSIGNED",
    typeId: null,
    priorityLevel: null,
    hours: 48,
    escalateToRole: "CAPTAIN",
    notifyRoles: null,
    isActive: true,
    ...overrides,
  };
}

describe("isSlaOpenStage", () => {
  it("counts the five stages where the office owes the resident an answer", () => {
    for (const stage of [
      "SUBMITTED",
      "ASSIGNED",
      "UNDER_ASSESSMENT",
      "AWAITING_BUDGET",
      "IN_PROGRESS",
    ]) {
      expect(isSlaOpenStage(stage)).toBe(true);
    }
  });

  it("does not clock RESOLVED, CLOSED or an unknown status", () => {
    expect(isSlaOpenStage("RESOLVED")).toBe(false);
    expect(isSlaOpenStage("CLOSED")).toBe(false);
    expect(isSlaOpenStage("CANCELLED")).toBe(false);
  });
});

describe("policySpecificity", () => {
  it("rejects a policy for another stage and an inactive policy", () => {
    expect(policySpecificity(policy({ id: 1 }), { stage: "IN_PROGRESS" })).toBe(-1);
    expect(
      policySpecificity(policy({ id: 2, isActive: false }), { stage: "ASSIGNED" })
    ).toBe(-1);
  });

  it("rejects a type- or priority-restricted policy when the case has none", () => {
    expect(policySpecificity(policy({ id: 1, typeId: 3 }), { stage: "ASSIGNED" })).toBe(-1);
    expect(
      policySpecificity(policy({ id: 1, priorityLevel: "HIGH" }), { stage: "ASSIGNED" })
    ).toBe(-1);
  });

  it("scores stage-only below priority-only below type below type+priority", () => {
    const scope = { stage: "ASSIGNED", typeId: 3, priorityLevel: "HIGH" };
    expect(policySpecificity(policy({ id: 1 }), scope)).toBe(0);
    expect(policySpecificity(policy({ id: 1, priorityLevel: "HIGH" }), scope)).toBe(1);
    expect(policySpecificity(policy({ id: 1, typeId: 3 }), scope)).toBe(2);
    expect(policySpecificity(policy({ id: 1, typeId: 3, priorityLevel: "HIGH" }), scope)).toBe(3);
  });

  it("rejects a policy restricted to a different type or priority", () => {
    const scope = { stage: "ASSIGNED", typeId: 3, priorityLevel: "HIGH" };
    expect(policySpecificity(policy({ id: 1, typeId: 4 }), scope)).toBe(-1);
    expect(policySpecificity(policy({ id: 1, priorityLevel: "LOW" }), scope)).toBe(-1);
  });
});

describe("resolveSlaPolicy", () => {
  const scope = { stage: "ASSIGNED", typeId: 3, priorityLevel: "HIGH" };

  it("picks the most specific policy", () => {
    const policies = [
      policy({ id: 1, hours: 72 }),
      policy({ id: 2, typeId: 3, hours: 24 }),
      policy({ id: 3, typeId: 3, priorityLevel: "HIGH", hours: 8 }),
    ];
    expect(resolveSlaPolicy(policies, scope)?.id).toBe(3);
  });

  it("breaks a tie by the lowest id so the window is stable", () => {
    const policies = [
      policy({ id: 9, typeId: 3, hours: 10 }),
      policy({ id: 4, typeId: 3, hours: 30 }),
    ];
    expect(resolveSlaPolicy(policies, scope)?.id).toBe(4);
  });

  it("falls back to a stage-only policy and returns null when nothing matches", () => {
    expect(resolveSlaPolicy([policy({ id: 7, hours: 60 })], scope)?.id).toBe(7);
    expect(resolveSlaPolicy([policy({ id: 7, stage: "IN_PROGRESS" })], scope)).toBeNull();
    expect(resolveSlaPolicy([], scope)).toBeNull();
  });
});

describe("resolveSlaWindow", () => {
  it("uses the policy hours when a policy matches", () => {
    const result = resolveSlaWindow([policy({ id: 1, hours: 24 })], { stage: "ASSIGNED" });
    expect(result.hours).toBe(24);
    expect(result.policy?.id).toBe(1);
  });

  it("defaults to 48 hours with no policy, and repairs a nonsense value", () => {
    expect(resolveSlaWindow([], { stage: "SUBMITTED" })).toEqual({
      policy: null,
      hours: SLA_DEFAULT_HOURS,
    });
    expect(SLA_DEFAULT_HOURS).toBe(48);
    expect(resolveSlaWindow([policy({ id: 1, hours: 0 })], { stage: "ASSIGNED" }).hours).toBe(48);
    expect(resolveSlaWindow([policy({ id: 1, hours: -5 })], { stage: "ASSIGNED" }).hours).toBe(48);
  });
});

describe("slaDueAt / hoursBetween", () => {
  const from = new Date("2026-10-12T00:00:00.000Z");

  it("adds the window to the instant the stage was entered", () => {
    expect(slaDueAt(from, 48).toISOString()).toBe("2026-10-14T00:00:00.000Z");
    expect(slaDueAt(from, 48).getTime() - from.getTime()).toBe(48 * 60 * 60 * 1000);
  });

  it("counts whole hours and never goes negative", () => {
    expect(hoursBetween(from, new Date("2026-10-13T23:59:59.000Z"))).toBe(47);
    expect(hoursBetween(from, new Date("2026-10-14T00:00:00.000Z"))).toBe(48);
    expect(hoursBetween(from, new Date("2026-10-11T00:00:00.000Z"))).toBe(0);
  });
});

describe("escalationLevelFor", () => {
  const dueAt = new Date("2026-10-14T00:00:00.000Z");

  it("is 0 while the window is still open", () => {
    expect(escalationLevelFor({ dueAt, now: new Date("2026-10-13T23:59:00.000Z"), hours: 48 })).toBe(0);
  });

  it("is 1 at the deadline and 2 after one more full window", () => {
    expect(escalationLevelFor({ dueAt, now: dueAt, hours: 48 })).toBe(1);
    expect(
      escalationLevelFor({ dueAt, now: new Date("2026-10-14T23:00:00.000Z"), hours: 48 })
    ).toBe(1);
    expect(
      escalationLevelFor({ dueAt, now: new Date("2026-10-16T00:00:00.000Z"), hours: 48 })
    ).toBe(2);
  });

  it("caps the level so a forgotten case cannot grow forever", () => {
    expect(
      escalationLevelFor({ dueAt, now: new Date("2026-10-18T00:00:00.000Z"), hours: 48 })
    ).toBe(3);
    expect(
      escalationLevelFor({ dueAt, now: new Date("2027-01-01T00:00:00.000Z"), hours: 48 })
    ).toBe(3);
    expect(
      escalationLevelFor({ dueAt, now: new Date("2027-01-01T00:00:00.000Z"), hours: 48, maxLevel: 2 })
    ).toBe(2);
  });
});

describe("dedupe key and labels", () => {
  it("keys an escalation by case, stage and level", () => {
    expect(escalationDedupeKey(42, "ASSIGNED", 1)).toBe("42:ASSIGNED:1");
    expect(escalationDedupeKey(42, "ASSIGNED", 2)).not.toBe(escalationDedupeKey(42, "ASSIGNED", 1));
  });

  it("labels a level", () => {
    expect(escalationLevelLabel(1)).toContain("deadline");
    expect(escalationLevelLabel(3)).toContain("3×");
  });
});

describe("recipientRoles", () => {
  it("puts the policy role first and de-duplicates the rest", () => {
    expect(
      recipientRoles({ escalateToRole: "captain", notifyRoles: "ADMIN, TREASURER, ADMIN" })
    ).toEqual(["CAPTAIN", "ADMIN", "TREASURER"]);
  });

  it("defaults to the Captain and tolerates an empty list", () => {
    expect(recipientRoles(null)).toEqual(["CAPTAIN"]);
    expect(recipientRoles({ escalateToRole: "", notifyRoles: "  " })).toEqual(["CAPTAIN"]);
    expect(recipientRoles({ escalateToRole: "ADMIN", notifyRoles: "CAPTAIN" })).toEqual([
      "ADMIN",
      "CAPTAIN",
    ]);
  });
});

describe("summarizeEscalations", () => {
  it("counts open, acknowledged and resolved rows per level", () => {
    const counts = summarizeEscalations([
      { level: 1, acknowledgedAt: null, resolvedAt: null },
      { level: 1, acknowledgedAt: new Date(), resolvedAt: null },
      { level: 2, acknowledgedAt: new Date(), resolvedAt: new Date() },
      { level: 3, acknowledgedAt: new Date(), resolvedAt: new Date() },
    ]);
    expect(counts).toEqual({
      total: 4,
      open: 1,
      acknowledged: 1,
      resolved: 2,
      byLevel: { 1: 2, 2: 1, 3: 1 },
    });
  });
});
