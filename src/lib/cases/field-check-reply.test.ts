import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  createApiError: {
    notFound: (message: string) => Object.assign(new Error(message), { status: 404 }),
    conflict: (message: string) => Object.assign(new Error(message), { status: 409 }),
    badRequest: (message: string) => Object.assign(new Error(message), { status: 400 }),
  },
}));
vi.mock("@/lib/notifications/service", () => ({
  notifyResidentReplyReceived: vi.fn().mockResolvedValue(2),
}));

import { notifyResidentReplyReceived } from "@/lib/notifications/service";
import { replyToFieldCheck } from "./field-check-reply";

function fakeDb(check: Record<string, unknown> | null) {
  const historyCreate = vi.fn().mockResolvedValue({ id: 91 });
  const db = {
    fieldCheck: { findFirst: vi.fn().mockResolvedValue(check) },
    caseStatusHistory: { create: historyCreate },
  };
  return { db: db as never, historyCreate };
}

const baseCheck = {
  id: 7,
  status: "PENDING",
  concern: {
    id: 12,
    caseNumber: "BR-2026-0012",
    userId: 44,
    assignedOfficeId: 5,
    assignedOfficialId: 2,
  },
};

describe("replyToFieldCheck", () => {
  it("stores a resident-visible reply tied to the field check and notifies case staff", async () => {
    const { db, historyCreate } = fakeDb(baseCheck);
    await expect(
      replyToFieldCheck(db, {
        concernId: 12,
        fieldCheckId: 7,
        message: "  The light is still out after dark.  ",
        actor: { id: 44 },
      })
    ).resolves.toEqual({ replyId: 91, caseNumber: "BR-2026-0012" });

    expect(historyCreate).toHaveBeenCalledWith({
      data: {
        concernId: 12,
        entryType: "RESIDENT_REPLY",
        remarks: "The light is still out after dark.",
        visibility: "RESIDENT_VISIBLE",
        metadataJson: JSON.stringify({ fieldCheckId: 7 }),
        actorId: 44,
        actorRole: "RESIDENT",
      },
      select: { id: true },
    });
    expect(notifyResidentReplyReceived).toHaveBeenCalledWith(db, {
      concernId: 12,
      caseNumber: "BR-2026-0012",
      officeId: 5,
      officialId: 2,
    });
  });

  it("does not reveal a case or check when the resident does not own it", async () => {
    const { db, historyCreate } = fakeDb({
      ...baseCheck,
      concern: { ...baseCheck.concern, userId: 45 },
    });
    await expect(
      replyToFieldCheck(db, {
        concernId: 12,
        fieldCheckId: 7,
        message: "More information.",
        actor: { id: 44 },
      })
    ).rejects.toMatchObject({ status: 404 });
    expect(historyCreate).not.toHaveBeenCalled();
  });

  it("rejects replies after an admin has approved the check", async () => {
    const { db, historyCreate } = fakeDb({ ...baseCheck, status: "APPROVED" });
    await expect(
      replyToFieldCheck(db, {
        concernId: 12,
        fieldCheckId: 7,
        message: "More information.",
        actor: { id: 44 },
      })
    ).rejects.toMatchObject({ status: 409 });
    expect(historyCreate).not.toHaveBeenCalled();
  });
});
