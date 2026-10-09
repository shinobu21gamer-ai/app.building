import { describe, expect, it } from "vitest";
import {
  actionDateForDay,
  actionDateProblem,
  earliestActionDay,
  isValidCalendarDay,
  journalDay,
  lastStatusChangeDay,
  manilaDay,
  todayManila,
} from "./action-date";

const SUBMITTED_ON = "2026-09-20";
const BOUNDS = {
  today: "2026-10-09",
  submittedDay: SUBMITTED_ON,
  lastStatusDay: "2026-09-25",
};

describe("isValidCalendarDay", () => {
  it("accepts real calendar days, including leap days", () => {
    expect(isValidCalendarDay("2026-09-20")).toBe(true);
    expect(isValidCalendarDay("2028-02-29")).toBe(true);
  });

  it("rejects impossible dates and malformed strings", () => {
    for (const bad of [
      "2026-02-30",
      "2026-02-29",
      "2026-13-01",
      "2026-9-20",
      "20260920",
      "2026-09-20T00:00",
      "",
    ]) {
      expect(isValidCalendarDay(bad)).toBe(false);
    }
  });
});

describe("manilaDay", () => {
  it("uses the Asia/Manila calendar day, not the UTC day", () => {
    // 20:00 UTC on Sep 30 is already 04:00 on Oct 1 in Manila (UTC+8).
    expect(manilaDay("2026-09-30T20:00:00Z")).toBe("2026-10-01");
    expect(manilaDay("2026-09-30T15:59:00Z")).toBe("2026-09-30");
  });

  it("reports today's Manila day from a supplied instant", () => {
    expect(todayManila(new Date("2026-10-08T17:00:00Z"))).toBe("2026-10-09");
  });
});

describe("actionDateForDay", () => {
  it("stores midday in Manila so the calendar day cannot drift", () => {
    const stored = actionDateForDay("2026-09-20");
    expect(stored.toISOString()).toBe("2026-09-20T04:00:00.000Z");
    expect(manilaDay(stored)).toBe("2026-09-20");
  });
});

describe("actionDateProblem", () => {
  it("accepts today", () => {
    expect(
      actionDateProblem("2026-10-09", BOUNDS, { statusChange: true })
    ).toBeNull();
  });

  it("rejects a future day", () => {
    expect(
      actionDateProblem("2026-10-10", BOUNDS, { statusChange: false })
    ).toBe("future");
  });

  it("rejects a day before the case was submitted", () => {
    expect(
      actionDateProblem("2026-09-19", BOUNDS, { statusChange: false })
    ).toBe("before-submission");
  });

  it("accepts the submission day when no status has changed yet", () => {
    expect(
      actionDateProblem(
        SUBMITTED_ON,
        { ...BOUNDS, lastStatusDay: null },
        { statusChange: true }
      )
    ).toBeNull();
  });

  it("does not let a status change predate the previous status change", () => {
    expect(
      actionDateProblem("2026-09-24", BOUNDS, { statusChange: true })
    ).toBe("before-last-status");
    expect(
      actionDateProblem("2026-09-25", BOUNDS, { statusChange: true })
    ).toBeNull();
  });

  it("lets remarks and actions predate the last status change", () => {
    expect(
      actionDateProblem("2026-09-22", BOUNDS, { statusChange: false })
    ).toBeNull();
  });
});

describe("lastStatusChangeDay", () => {
  it("is null before any status change", () => {
    expect(lastStatusChangeDay([])).toBeNull();
  });

  it("uses the latest real transition, dated by its action date when set", () => {
    const day = lastStatusChangeDay([
      {
        fromStatus: null,
        toStatus: "SUBMITTED",
        occurredOn: null,
        createdAt: new Date("2026-09-20T02:00:00Z"),
      },
      {
        fromStatus: "SUBMITTED",
        toStatus: "ASSIGNED",
        occurredOn: null,
        createdAt: new Date("2026-09-20T02:00:01Z"),
      },
      {
        // Recorded on Oct 9 but the work started on Sep 24.
        fromStatus: "ASSIGNED",
        toStatus: "IN_PROGRESS",
        occurredOn: actionDateForDay("2026-09-24"),
        createdAt: new Date("2026-10-09T01:00:00Z"),
      },
      {
        // A remark recorded while in progress is not a transition.
        fromStatus: "IN_PROGRESS",
        toStatus: "IN_PROGRESS",
        occurredOn: actionDateForDay("2026-10-08"),
        createdAt: new Date("2026-10-09T01:05:00Z"),
      },
      {
        // SLA breach entries carry no status at all.
        fromStatus: null,
        toStatus: null,
        occurredOn: null,
        createdAt: new Date("2026-10-09T01:10:00Z"),
      },
    ]);
    expect(day).toBe("2026-09-24");
  });
});

describe("journalDay", () => {
  it("prefers the action date over the record time", () => {
    expect(
      journalDay({
        occurredOn: actionDateForDay("2026-09-24"),
        createdAt: new Date("2026-10-09T01:00:00Z"),
      })
    ).toBe("2026-09-24");
  });

  it("falls back to the record time for automated entries", () => {
    expect(
      journalDay({
        occurredOn: null,
        createdAt: new Date("2026-09-30T20:00:00Z"),
      })
    ).toBe("2026-10-01");
  });
});

describe("earliestActionDay", () => {
  it("bounds status changes by the last status change", () => {
    expect(
      earliestActionDay(
        { submittedDay: SUBMITTED_ON, lastStatusDay: "2026-09-25" },
        { statusChange: true }
      )
    ).toBe("2026-09-25");
  });

  it("falls back to the submission day when no status has changed", () => {
    expect(
      earliestActionDay(
        { submittedDay: SUBMITTED_ON, lastStatusDay: null },
        { statusChange: true }
      )
    ).toBe(SUBMITTED_ON);
  });

  it("bounds remarks and actions by the submission day only", () => {
    expect(
      earliestActionDay(
        { submittedDay: SUBMITTED_ON, lastStatusDay: "2026-09-25" },
        { statusChange: false }
      )
    ).toBe(SUBMITTED_ON);
  });
});
