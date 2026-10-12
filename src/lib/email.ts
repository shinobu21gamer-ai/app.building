import nodemailer, { type Transporter } from "nodemailer";
import { recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";

type ProgressEmailInput = {
  concernId: number;
  caseNumber: string;
  status: string;
  remarks: string;
};

let transporter: Transporter | null | undefined;

function getTransporter(): Transporter | null {
  if (transporter !== undefined) return transporter;

  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  if (!host || !user || !pass) {
    transporter = null;
    return null;
  }

  const port = Number(process.env.SMTP_PORT ?? 587);
  transporter = nodemailer.createTransport({
    host,
    port,
    secure: process.env.SMTP_SECURE === "true" || port === 465,
    auth: { user, pass },
  });
  return transporter;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/**
 * Sends a progress update without allowing email failures to affect the case workflow.
 * SMTP is disabled when the required environment variables are absent.
 */
export async function sendConcernProgressEmail(
  input: ProgressEmailInput
): Promise<void> {
  const mailer = getTransporter();
  const from = process.env.SMTP_FROM ?? process.env.SMTP_USER;
  if (!mailer || !from) return;

  let concern: { user: { email: string } } | null;
  try {
    concern = await db.concern.findUnique({
      where: { id: input.concernId },
      select: { user: { select: { email: true } } },
    });
  } catch (error) {
    console.error("[email] failed to load concern recipient:", error);
    return;
  }

  if (!concern) return;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const status = input.status.replaceAll("_", " ").toLowerCase();
  const subject = `Update on concern ${input.caseNumber}`;
  const text = [
    `Your concern ${input.caseNumber} has been updated.`,
    `Status: ${status}`,
    `Progress note: ${input.remarks}`,
    `View your concern: ${appUrl}/resident/concerns/${input.concernId}`,
  ].join("\n\n");
  const html = `
        <p>Your concern <strong>${escapeHtml(input.caseNumber)}</strong> has been updated.</p>
        <p><strong>Status:</strong> ${escapeHtml(status)}</p>
        <p><strong>Progress note:</strong> ${escapeHtml(input.remarks)}</p>
        <p><a href="${escapeHtml(appUrl)}/resident/concerns/${input.concernId}">View your concern</a></p>
      `;

  let delivery: { id: number };
  try {
    delivery = await db.emailDelivery.create({
      data: {
        concernId: input.concernId,
        recipient: concern.user.email,
        subject,
        textBody: text,
        htmlBody: html,
        eventType: "CONCERN_PROGRESS",
        status: "PENDING",
        attempts: 1,
      },
      select: { id: true },
    });
  } catch (error) {
    console.error("[email] failed to record delivery:", error);
    return;
  }

  try {
    await mailer.sendMail({
      from,
      to: concern.user.email,
      subject,
      text,
      html,
    });
    await db.emailDelivery.update({
      where: { id: delivery.id },
      data: { status: "SENT", sentAt: new Date(), nextAttemptAt: null },
    });
  } catch (error) {
    console.error("[email] failed to send concern progress update:", error);
    try {
      await db.emailDelivery.update({
        where: { id: delivery.id },
        data: {
          status: "FAILED",
          lastError: error instanceof Error ? error.message : "Unknown email error",
          nextAttemptAt: new Date(Date.now() + 15 * 60 * 1000),
        },
      });
    } catch (dbError) {
      console.error("[email] failed to record delivery failure:", dbError);
    }
  }
}

/** Deliveries claimed per run. */
export const EMAIL_RETRY_BATCH = 25;
/** A row left in SENDING this long was abandoned by a run that died mid-send. */
export const EMAIL_SENDING_TIMEOUT_MS = 15 * 60 * 1000;
/** Attempts after which a delivery is given up on. */
export const EMAIL_MAX_ATTEMPTS = 5;

/** Rows in SENDING last touched before this instant are considered abandoned. */
export function stuckSendingCutoff(now: Date): Date {
  return new Date(now.getTime() - EMAIL_SENDING_TIMEOUT_MS);
}

export type EmailRetryOptions = {
  /** Who asked for the run: the cron scheduler, or an admin from the console. */
  trigger?: "CRON" | "ADMIN";
  actorId?: number | null;
};

/**
 * Sends pending and failed emails. Every batch that touches a row is recorded
 * in the audit chain, and rows a crashed run left in SENDING are put back in
 * line for a retry (their attempt is already counted, so the cap still holds).
 *
 * Returns how many emails were sent. Without SMTP configured it does nothing
 * and touches no rows.
 */
export async function retryPendingEmailDeliveries(
  limit = EMAIL_RETRY_BATCH,
  options: EmailRetryOptions = {}
): Promise<number> {
  const mailer = getTransporter();
  const from = process.env.SMTP_FROM ?? process.env.SMTP_USER;
  if (!mailer || !from) return 0;

  const now = new Date();
  const trigger = options.trigger ?? "CRON";

  const reset = await db.emailDelivery.updateMany({
    where: { status: "SENDING", updatedAt: { lt: stuckSendingCutoff(now) } },
    data: {
      status: "FAILED",
      lastError: "Left in SENDING by an interrupted run; reset for retry.",
      nextAttemptAt: now,
    },
  });

  const deliveries = await db.emailDelivery.findMany({
    where: {
      status: { in: ["PENDING", "FAILED"] },
      attempts: { lt: EMAIL_MAX_ATTEMPTS },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  let sent = 0;
  const sentIds: number[] = [];
  const failedIds: number[] = [];
  for (const delivery of deliveries) {
    const claimed = await db.emailDelivery.updateMany({
      where: { id: delivery.id, status: { in: ["PENDING", "FAILED"] } },
      data: { status: "SENDING", attempts: { increment: 1 } },
    });
    if (claimed.count !== 1) continue;

    try {
      await mailer.sendMail({
        from,
        to: delivery.recipient,
        subject: delivery.subject,
        text: delivery.textBody,
        html: delivery.htmlBody ?? undefined,
      });
      await db.emailDelivery.update({
        where: { id: delivery.id },
        data: { status: "SENT", sentAt: new Date(), nextAttemptAt: null },
      });
      sent += 1;
      sentIds.push(delivery.id);
    } catch (error) {
      await db.emailDelivery.update({
        where: { id: delivery.id },
        data: {
          status: "FAILED",
          lastError: error instanceof Error ? error.message : "Unknown email error",
          nextAttemptAt: new Date(Date.now() + 15 * 60 * 1000),
        },
      });
      failedIds.push(delivery.id);
    }
  }

  // The audit entry carries counts and row ids only: no addresses, no bodies.
  if (reset.count > 0 || deliveries.length > 0) {
    await recordAudit(
      {
        action: "EMAIL_RETRY_BATCH",
        resourceType: "EmailDelivery",
        description:
          `${trigger} retry: ${deliveries.length} attempted, ${sent} sent` +
          `, ${failedIds.length} failed, ${reset.count} reset from SENDING` +
          (sentIds.length ? `. Sent ids: ${sentIds.join(",")}` : "") +
          (failedIds.length ? `. Failed ids: ${failedIds.join(",")}` : ""),
        userId: options.actorId ?? null,
        actorRole: trigger === "CRON" ? "CRON" : "ADMIN",
      }
    );
  }

  return sent;
}

export async function sendSystemAlertEmails(input: {
  title: string;
  message: string;
  severity: string;
}): Promise<void> {
  const mailer = getTransporter();
  const from = process.env.SMTP_FROM ?? process.env.SMTP_USER;
  if (!mailer || !from) return;

  const users = await db.user.findMany({
    where: { isActive: true },
    select: { email: true },
  });
  const subject = `[${input.severity}] BarangayResolve alert: ${input.title}`;
  const text = `${input.title}\n\n${input.message}\n\nSign in to BarangayResolve to acknowledge this alert.`;
  for (const user of users) {
    let delivery;
    try {
      delivery = await db.emailDelivery.create({
        data: {
          recipient: user.email,
          subject,
          textBody: text,
          eventType: "SYSTEM_ALERT",
          status: "SENDING",
          attempts: 1,
        },
        select: { id: true },
      });
      await mailer.sendMail({ from, to: user.email, subject, text });
      await db.emailDelivery.update({
        where: { id: delivery.id },
        data: { status: "SENT", sentAt: new Date() },
      });
    } catch (error) {
      if (delivery) {
        await db.emailDelivery.update({
          where: { id: delivery.id },
          data: {
            status: "FAILED",
            lastError: error instanceof Error ? error.message : "Unknown email error",
            nextAttemptAt: new Date(Date.now() + 15 * 60 * 1000),
          },
        });
      } else {
        console.error("[email] failed to record system alert delivery:", error);
      }
    }
  }
}
