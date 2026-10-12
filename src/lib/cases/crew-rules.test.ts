import { describe, expect, it } from "vitest";
import {
  conflictMessage,
  findCrewConflicts,
  remainingCrewSlots,
  windowsOverlap,
} from "./crew-rules";

const day = (value: string) => new Date(`${value}T08:00:00+08:00`);

describe("windowsOverlap", () => {
  it("detects overlapping windows", () => {
    expect(
      windowsOverlap(
        { startAt: day("2026-10-12"), endAt: day("2026-10-14") },
        { startAt: day("2026-10-13"), endAt: day("2026-10-15") }
      )
    ).toBe(true);
  });

  it("does not treat back-to-back work as a conflict", () => {
    expect(
      windowsOverlap(
        { startAt: day("2026-10-12"), endAt: day("2026-10-13") },
        { startAt: day("2026-10-13"), endAt: day("2026-10-14") }
      )
    ).toBe(false);
  });

  it("treats an open bound as unbounded", () => {
    expect(
      windowsOverlap(
        { startAt: null, endAt: null },
        { startAt: day("2026-10-12"), endAt: day("2026-10-13") }
      )
    ).toBe(true);
    expect(
      windowsOverlap(
        { startAt: day("2026-10-12"), endAt: null },
        { startAt: day("2026-11-01"), endAt: day("2026-11-02") }
      )
    ).toBe(true);
    expect(
      windowsOverlap(
        { startAt: day("2026-10-12"), endAt: day("2026-10-13") },
        { startAt: day("2026-10-14"), endAt: day("2026-10-15") }
      )
    ).toBe(false);
  });
});

describe("findCrewConflicts", () => {
  const candidate = {
    startAt: day("2026-10-12"),
    endAt: day("2026-10-14"),
  };

  it("flags the same person booked elsewhere at the same time", () => {
    const conflicts = findCrewConflicts({
      bookings: [
        {
          crewId: 7,
          concernId: 99,
          caseNumber: "BR-20261001-0002",
          startAt: day("2026-10-13"),
          endAt: day("2026-10-15"),
        },
      ],
      candidate,
      crewIds: [7, 8],
      concernId: 42,
    });
    expect(conflicts).toEqual([
      { crewId: 7, concernId: 99, caseNumber: "BR-20261001-0002" },
    ]);
  });

  it("ignores other crew, other cases outside the window and the same case", () => {
    const conflicts = findCrewConflicts({
      bookings: [
        { crewId: 9, concernId: 99, startAt: candidate.startAt, endAt: candidate.endAt },
        { crewId: 7, concernId: 98, startAt: day("2026-11-01"), endAt: day("2026-11-02") },
        { crewId: 7, concernId: 42, startAt: candidate.startAt, endAt: candidate.endAt },
      ],
      candidate,
      crewIds: [7],
      concernId: 42,
    });
    expect(conflicts).toEqual([]);
  });

  it("explains the clash in the message", () => {
    expect(
      conflictMessage([
        { crewId: 7, concernId: 99, caseNumber: "BR-20261001-0002" },
        { crewId: 7, concernId: 99, caseNumber: "BR-20261001-0002" },
      ])
    ).toContain("BR-20261001-0002");
  });
});

describe("remainingCrewSlots", () => {
  it("counts the slots the plan still has", () => {
    expect(
      remainingCrewSlots({ workersNeeded: 3, activeCrew: 1, requested: 2 })
    ).toEqual({ allowed: true, remaining: 2 });
    expect(
      remainingCrewSlots({ workersNeeded: 3, activeCrew: 2, requested: 2 })
    ).toEqual({ allowed: false, remaining: 1 });
  });

  it("falls back to the hard ceiling without a plan", () => {
    expect(
      remainingCrewSlots({ workersNeeded: null, activeCrew: 0, requested: 5 })
    ).toEqual({ allowed: true, remaining: 100 });
  });
});
