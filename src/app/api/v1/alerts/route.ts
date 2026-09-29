import { db } from "@/lib/db";
import { after } from "next/server";
import { assertSameOrigin, ok, parseBody, withErrorBoundary } from "@/lib/api";
import { requireApiRole, requireApiUser } from "@/lib/auth/session";
import { getAlertsForUser } from "@/lib/alerts";
import { createAlertSchema } from "@/lib/validations/alert";
import { sendSystemAlertEmails } from "@/lib/email";
import { sendSystemAlertPush } from "@/lib/push";

export const runtime = "nodejs";

export const GET = withErrorBoundary(async (req: Request) => {
  const user = await requireApiUser();
  const activeOnly = new URL(req.url).searchParams.get("active") === "true";
  return ok({ alerts: await getAlertsForUser(user.id, activeOnly) });
});

export const POST = withErrorBoundary(async (req: Request) => {
  assertSameOrigin(req);
  const user = await requireApiRole(["ADMIN"]);
  const input = await parseBody(req, createAlertSchema);
  const alert = await db.systemAlert.create({
    data: {
      title: input.title,
      message: input.message,
      severity: input.severity,
      sound: input.sound,
      createdById: user.id,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
    },
  });
  // `after` keeps these deliveries alive past the response. A bare `void`
  // promise is unsafe on serverless hosts, where the function can be frozen
  // the moment the response is sent and the push would silently never go out.
  after(async () => {
    await Promise.allSettled([
      sendSystemAlertEmails({
        title: alert.title,
        message: alert.message,
        severity: alert.severity,
      }),
      sendSystemAlertPush({
        alertId: alert.id,
        title: alert.title,
        message: alert.message,
        severity: alert.severity,
      }),
    ]);
  });

  return ok({ alert: { id: alert.id, title: alert.title } });
});
