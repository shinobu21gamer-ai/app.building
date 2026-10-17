import { describe, expect, it, vi } from "vitest";
import {
  NOTIFICATION_TYPES,
  notifyCrewAssigned,
  notifyCrewProgressRecorded,
  notifyResidentReplyReceived,
  notifySlaBreached,
  notifyTreasurerCrewPaymentReady,
} from "@/lib/notifications/service";

function fakeDb() {
  const create = vi.fn().mockResolvedValue({});
  return { db: { notification: { create } } as never, create };
}

describe("notifyCrewAssigned", () => {
  it("writes a CONCERN_ASSIGNED row for the crew member through the service", async () => {
    const { db, create } = fakeDb();
    await notifyCrewAssigned(db, {
      userId: 15,
      concernId: 9,
      caseNumber: "BR-2026-0009",
      schedule: " Scheduled 20 Oct, 9:00 AM.",
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        userId: 15,
        concernId: 9,
        type: NOTIFICATION_TYPES.CONCERN_ASSIGNED,
        title: "Crew assignment",
        message: "You have been assigned to case BR-2026-0009 as crew. Scheduled 20 Oct, 9:00 AM.",
      },
    });
  });

  it("reads cleanly when no schedule is set", async () => {
    const { db, create } = fakeDb();
    await notifyCrewAssigned(db, { userId: 15, concernId: 9, caseNumber: "BR-1", schedule: "" });
    expect(create.mock.calls[0][0].data.message).toBe("You have been assigned to case BR-1 as crew.");
  });
});

describe("notifyCrewProgressRecorded", () => {
  it("notifies the case office and named official without duplicate recipients", async () => {
    const create = vi.fn().mockResolvedValue({});
    const findMany = vi.fn().mockResolvedValue([{ id: 31 }, { id: 32 }]);
    const db = {
      user: { findMany },
      notification: { create },
    } as never;

    await expect(notifyCrewProgressRecorded(db, {
      concernId: 9,
      caseNumber: "BR-2026-0009",
      officeId: 4,
      officialId: 32,
      crewName: "Ava Reyes",
      kind: "COMPLETION",
    })).resolves.toBe(2);

    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls.map(([arg]) => arg.data.userId)).toEqual([31, 32]);
    expect(create.mock.calls[0][0].data).toMatchObject({
      concernId: 9,
      type: NOTIFICATION_TYPES.CREW_PROGRESS_RECEIVED,
      title: "Crew update needs review",
      message: "Ava Reyes reported work completed on case BR-2026-0009. Review the internal update on the case.",
    });
  });

  it("falls back to active admins when no official holds the office assignment", async () => {
    const create = vi.fn().mockResolvedValue({});
    const findMany = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 1 }]);
    const db = {
      user: { findMany },
      notification: { create },
    } as never;

    await expect(notifyCrewProgressRecorded(db, {
      concernId: 9,
      caseNumber: "BR-2026-0009",
      officeId: 4,
      officialId: null,
      crewName: "Ava Reyes",
      kind: "PROBLEM",
    })).resolves.toBe(1);
    expect(create.mock.calls[0][0].data.userId).toBe(1);
    expect(create.mock.calls[0][0].data.message).toContain("reported a problem");
  });
});

describe("notifyTreasurerCrewPaymentReady", () => {
  it("notifies each active treasurer once with the closed case details", async () => {
    const create = vi.fn().mockResolvedValue({});
    const db = {
      user: { findMany: vi.fn().mockResolvedValue([{ id: 21 }, { id: 22 }]) },
      notification: {
        findFirst: vi.fn().mockResolvedValue(null),
        create,
      },
    } as never;

    const sent = await notifyTreasurerCrewPaymentReady(db, {
      concernId: 9,
      caseNumber: "BR-2026-0009",
      crewCount: 2,
    });

    expect(sent).toBe(2);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledWith({
      data: {
        userId: 21,
        concernId: 9,
        type: NOTIFICATION_TYPES.CREW_PAYMENT_READY,
        title: "Crew payment ready for review",
        message: "Case BR-2026-0009 is closed and has 2 assigned crew members. Review the crew payment request in Treasury.",
      },
    });
  });

  it("does not notify treasurers when the case had no assigned crew", async () => {
    const findMany = vi.fn();
    const db = { user: { findMany } } as never;
    await expect(notifyTreasurerCrewPaymentReady(db, {
      concernId: 9,
      caseNumber: "BR-2026-0009",
      crewCount: 0,
    })).resolves.toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe("notifyResidentReplyReceived", () => {
  it("alerts admins and assigned office staff without duplicating the named official", async () => {
    const create = vi.fn().mockResolvedValue({});
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([{ id: 1 }])
      .mockResolvedValueOnce([{ id: 2 }]);
    const db = {
      user: { findMany },
      notification: { create },
    } as never;

    await expect(
      notifyResidentReplyReceived(db, {
        concernId: 9,
        caseNumber: "BR-2026-0009",
        officeId: 4,
        officialId: 2,
      })
    ).resolves.toBe(2);

    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls.map(([arg]) => arg.data.userId)).toEqual([1, 2]);
    expect(create.mock.calls[0][0].data).toMatchObject({
      concernId: 9,
      type: NOTIFICATION_TYPES.RESIDENT_REPLY_RECEIVED,
      title: "Resident replied to an open field check",
    });
  });
});

describe("notifySlaBreached", () => {
  it("writes an SLA_BREACHED row with the given copy", async () => {
    const { db, create } = fakeDb();
    await notifySlaBreached(db, {
      userId: 4,
      concernId: 2,
      title: "Case SLA breached",
      message: "BR-2 has been in UNDER_ASSESSMENT for 50h past its 48-hour window.",
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        userId: 4,
        concernId: 2,
        type: "SLA_BREACHED",
        title: "Case SLA breached",
        message: "BR-2 has been in UNDER_ASSESSMENT for 50h past its 48-hour window.",
      },
    });
  });
});
