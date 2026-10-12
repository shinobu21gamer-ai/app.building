import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendMail: vi.fn(),
  recordAudit: vi.fn(),
  emailDelivery: { updateMany: vi.fn(), findMany: vi.fn(), update: vi.fn() },
}));

vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail: mocks.sendMail }) },
}));
vi.mock("@/lib/audit", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("@/lib/db", () => ({ db: { emailDelivery: mocks.emailDelivery } }));

type EmailModule = typeof import("@/lib/email");
let email: EmailModule;

const NOW = new Date("2026-10-12T08:00:00Z");

function delivery(id: number) {
  return {
    id,
    recipient: `resident${id}@example.test`,
    subject: "Update",
    textBody: "Body",
    htmlBody: null,
  };
}

beforeAll(async () => {
  process.env.SMTP_HOST = "smtp.example.test";
  process.env.SMTP_USER = "mailer";
  process.env.SMTP_PASSWORD = "secret";
  process.env.SMTP_FROM = "noreply@example.test";
  email = await import("@/lib/email");
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  mocks.emailDelivery.updateMany.mockResolvedValue({ count: 0 });
  mocks.emailDelivery.findMany.mockResolvedValue([]);
  mocks.emailDelivery.update.mockResolvedValue({});
  mocks.sendMail.mockResolvedValue({});
});

describe("stuckSendingCutoff", () => {
  it("treats a row untouched for fifteen minutes as abandoned", () => {
    expect(email.stuckSendingCutoff(NOW).getTime()).toBe(
      NOW.getTime() - email.EMAIL_SENDING_TIMEOUT_MS
    );
    expect(email.EMAIL_SENDING_TIMEOUT_MS).toBe(15 * 60 * 1000);
  });
});

describe("retryPendingEmailDeliveries", () => {
  it("resets rows a crashed run left in SENDING before picking up new work", async () => {
    mocks.emailDelivery.updateMany.mockResolvedValueOnce({ count: 2 });

    await email.retryPendingEmailDeliveries(undefined, { trigger: "CRON" });

    const reset = mocks.emailDelivery.updateMany.mock.calls[0][0];
    expect(reset.where.status).toBe("SENDING");
    expect(reset.where.updatedAt.lt).toEqual(email.stuckSendingCutoff(NOW));
    expect(reset.data.status).toBe("FAILED");
    expect(reset.data.nextAttemptAt).toEqual(NOW);
  });

  it("sends, marks SENT, and audits the batch with ids only", async () => {
    mocks.emailDelivery.findMany.mockResolvedValueOnce([delivery(7)]);
    mocks.emailDelivery.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });

    const sent = await email.retryPendingEmailDeliveries(undefined, { trigger: "ADMIN", actorId: 3 });

    expect(sent).toBe(1);
    expect(mocks.emailDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "SENT" }) })
    );
    expect(mocks.recordAudit).toHaveBeenCalledTimes(1);
    const entry = mocks.recordAudit.mock.calls[0][0];
    expect(entry.action).toBe("EMAIL_RETRY_BATCH");
    expect(entry.userId).toBe(3);
    expect(entry.actorRole).toBe("ADMIN");
    expect(entry.description).toContain("1 sent");
    expect(entry.description).toContain("Sent ids: 7");
    expect(entry.description).not.toContain("@");
  });

  it("records a failed send with its id, and does not count it as sent", async () => {
    mocks.emailDelivery.findMany.mockResolvedValueOnce([delivery(8)]);
    mocks.emailDelivery.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
    mocks.sendMail.mockRejectedValueOnce(new Error("550 mailbox unavailable"));

    const sent = await email.retryPendingEmailDeliveries(undefined, { trigger: "CRON" });

    expect(sent).toBe(0);
    expect(mocks.emailDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "FAILED", lastError: "550 mailbox unavailable" }),
      })
    );
    const entry = mocks.recordAudit.mock.calls[0][0];
    expect(entry.description).toContain("Failed ids: 8");
    expect(entry.actorRole).toBe("CRON");
    expect(entry.userId).toBeNull();
  });

  it("writes no audit entry when there was nothing to do", async () => {
    await email.retryPendingEmailDeliveries(undefined, { trigger: "CRON" });
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });
});
