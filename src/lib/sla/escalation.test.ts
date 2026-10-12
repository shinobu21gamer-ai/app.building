import { describe, expect, it } from "vitest";
import { planEscalations, type SlaCaseLike } from "./escalation";
import type { SlaPolicyLike } from "./policy";

const NOW = new Date("2026-10-20T12:00:00.000Z");

function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000);
}

function kase(overrides: Partial<SlaCaseLike> & { id: number }): SlaCaseLike {
  return {
    caseNumber: `BR-2026-${String(overrides.id).padStart(4, "0")}`,
    status: "ASSIGNED",
    // entered the stage 49 hours ago: one hour past a 48-hour window
    stageEnteredAt: hoursAgo(49),
    slaDueAt: null,
    typeId: null,
    priorityLevel: null,
    userId: 300,
    ...overrides,
  };
}

function policy(overrides: Partial<SlaPolicyLike> & { id: number }): SlaPolicyLike {
  return {
    key: `p-${overrides.id}`,
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

function plan(
  cases: SlaCaseLike[],
  input: { policies?: SlaPolicyLike[]; existing?: string[]; maxLevel?: number } = {}
) {
  return planEscalations({
    cases,
    policies: input.policies ?? [],
    now: NOW,
    existingKeys: new Set(input.existing ?? []),
    maxLevel: input.maxLevel,
  });
}

describe("planEscalations", () => {
  it("leaves a case inside its window alone", () => {
    expect(plan([kase({ id: 1, stageEnteredAt: hoursAgo(47) })])).toEqual([]);
  });

  it("escalates once the 48-hour window is missed", () => {
    const [first] = plan([kase({ id: 7 })]);
    expect(first).toMatchObject({
      concernId: 7,
      stage: "ASSIGNED",
      level: 1,
      hours: 48,
      escalateToRole: "CAPTAIN",
      recipientRoles: ["CAPTAIN"],
      policyId: null,
      residentUserId: 300,
      dedupeKey: "7:ASSIGNED:1",
    });
    expect(first.hoursOverdue).toBe(1);
  });

  it("never writes the same level twice, whatever the run count", () => {
    expect(plan([kase({ id: 7 })], { existing: ["7:ASSIGNED:1"] })).toEqual([]);
  });

  it("writes the level that is missing, not the one already recorded", () => {
    const planned = plan([kase({ id: 7, stageEnteredAt: hoursAgo(97) })], {
      existing: ["7:ASSIGNED:1"],
    });
    expect(planned).toHaveLength(1);
    expect(planned[0].level).toBe(2);
    expect(planned[0].hoursOverdue).toBe(49);
  });

  it("fills in the levels a case missed before the job ever ran", () => {
    const planned = plan([kase({ id: 7, stageEnteredAt: hoursAgo(49 + 5 * 48) })]);
    expect(planned.map((row) => row.level)).toEqual([1, 2, 3]);
    // Older levels are dated at the moment they should have fired.
    expect(planned.map((row) => row.hoursOverdue)).toEqual([0, 48, 241]);
    expect(new Set(planned.map((row) => row.dedupeKey)).size).toBe(3);
  });

  it("stops at the maximum level", () => {
    const planned = plan([kase({ id: 7, stageEnteredAt: hoursAgo(49 + 5 * 48) })], {
      maxLevel: 2,
    });
    expect(planned.map((row) => row.level)).toEqual([1, 2]);
  });

  it("honours the window of the policy that applies", () => {
    const planned = plan([kase({ id: 7, stageEnteredAt: hoursAgo(25) })], {
      policies: [policy({ id: 4, hours: 24, escalateToRole: "ADMIN", notifyRoles: "CAPTAIN" })],
    });
    expect(planned).toHaveLength(1);
    expect(planned[0]).toMatchObject({
      hours: 24,
      policyId: 4,
      escalateToRole: "ADMIN",
      recipientRoles: ["ADMIN", "CAPTAIN"],
    });
  });

  it("prefers the most specific policy for the case", () => {
    const planned = plan(
      [kase({ id: 7, typeId: 3, priorityLevel: "HIGH", stageEnteredAt: hoursAgo(9) })],
      {
        policies: [
          policy({ id: 1, hours: 48 }),
          policy({ id: 2, typeId: 3, hours: 24 }),
          policy({ id: 3, typeId: 3, priorityLevel: "HIGH", hours: 8 }),
        ],
      }
    );
    expect(planned).toHaveLength(1);
    expect(planned[0].policyId).toBe(3);
    expect(planned[0].hours).toBe(8);
  });

  it("trusts the due date stored on the case over a fresh calculation", () => {
    const planned = plan([
      kase({
        id: 7,
        stageEnteredAt: hoursAgo(2),
        // e.g. the case was re-armed under an older, tighter policy
        slaDueAt: hoursAgo(6),
      }),
    ]);
    expect(planned).toHaveLength(1);
    expect(planned[0].hoursOverdue).toBe(6);
  });

  it("ignores stages where the office is no longer on the clock", () => {
    expect(plan([kase({ id: 7, status: "RESOLVED", stageEnteredAt: hoursAgo(500) })])).toEqual([]);
    expect(plan([kase({ id: 7, status: "CLOSED", stageEnteredAt: hoursAgo(500) })])).toEqual([]);
  });

  it("uses the window of each case's own stage", () => {
    const planned = plan(
      [
        kase({ id: 1, status: "SUBMITTED", stageEnteredAt: hoursAgo(60) }),
        kase({ id: 2, status: "IN_PROGRESS", stageEnteredAt: hoursAgo(60) }),
      ],
      { policies: [policy({ id: 1, stage: "IN_PROGRESS", hours: 120 })] }
    );
    // SUBMITTED has no policy (48h → overdue); IN_PROGRESS runs on its 120h policy.
    expect(planned.map((row) => [row.concernId, row.hours])).toEqual([[1, 48]]);
  });

  it("plans one row per case and level, in case order", () => {
    const planned = plan(
      [kase({ id: 1 }), kase({ id: 2 })],
      { existing: ["1:ASSIGNED:1"] }
    );
    expect(planned.map((row) => row.dedupeKey)).toEqual(["2:ASSIGNED:1"]);
  });
});
