import { db } from "@/lib/db";
import { assertSameOrigin, ok, parseBody, withErrorBoundary } from "@/lib/api";
import { requireApiRole, requireApiUser } from "@/lib/auth/session";
import { getAlertsForUser } from "@/lib/alerts";
import { createAlertSchema } from "@/lib/validations/alert";
import { sendSystemAlertEmails } from "@/lib/email";
import { sendSystemAlertPush } from "@/lib/push";
import type { SystemAlertPushReport } from "@/lib/push-types";

export const runtime = "nodejs";

const PUSH_DELIVERY_UNAVAILABLE: SystemAlertPushReport = {
  web: { registered: 0, accepted: 0, failed: 0, pruned: 0, skipped: 0, configured: false },
  android: { registered: 0, accepted: 0, failed: 0, pruned: 0, skipped: 0, configured: false },
  ios: { registered: 0, accepted: 0, failed: 0, pruned: 0, skipped: 0, configured: false },
};

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

  // Send push synchronously. On serverless (Vercel) the `after()` hook can
  // freeze before the push goes out, so the alert would never reach phones.
  // Awaiting here guarantees delivery before the response is returned.
  const [, pushResult] = await Promise.allSettled([
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
      sound: alert.sound,
      createdAt: alert.createdAt.toISOString(),
      expiresAt: alert.expiresAt?.toISOString() ?? null,
    }),
  ]);

  return ok({
    alert: { id: alert.id, title: alert.title },
    push:
      pushResult.status === "fulfilled"
        ? pushResult.value
        : {
            ...PUSH_DELIVERY_UNAVAILABLE,
            web: {
              ...PUSH_DELIVERY_UNAVAILABLE.web,
              reason: "Push delivery could not be evaluated; check server logs.",
            },
            android: {
              ...PUSH_DELIVERY_UNAVAILABLE.android,
              reason: "Push delivery could not be evaluated; check server logs.",
            },
            ios: {
              ...PUSH_DELIVERY_UNAVAILABLE.ios,
              reason: "Push delivery could not be evaluated; check server logs.",
            },
          },
  });
});
