import { describe, expect, it, vi } from "vitest";
import {
  NOTIFICATION_TYPES,
  notifyCrewAssigned,
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

describe("notifyTreasurerCrewPaymentReady", () => {
  it("notifies each active treasurer once with the resolved case details", async () => {
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
        message: "Case BR-2026-0009 is resolved and has 2 assigned crew members. Review the crew payment request in Treasury.",
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
