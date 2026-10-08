import { z } from "zod";

export const createAlertSchema = z.object({
  title: z.string().trim().min(3).max(120),
  message: z.string().trim().min(5).max(2000),
  severity: z.enum(["INFO", "WARNING", "CRITICAL"]),
  sound: z.boolean().default(true),
  expiresAt: z.string().datetime().optional().nullable(),
});

export const alertReactionSchema = z.object({
  reaction: z.enum(["ACKNOWLEDGED", "HELPFUL", "NEED_HELP"]),
});

export const acknowledgeAlertsSchema = z.object({
  alertIds: z
    .array(z.number().int().positive())
    .min(1, "Select at least one alert.")
    .max(500, "You can acknowledge up to 500 alerts at once.")
    .refine((ids) => new Set(ids).size === ids.length, "Alert IDs must be unique."),
});

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({
    p256dh: z.string().min(16).max(500),
    auth: z.string().min(8).max(500),
  }),
});

/**
 * Optional device hint sent with a sign-out so the server can unregister
 * *this* device only, instead of every device signed in to the account.
 * Every field is optional: a client that knows nothing about its push
 * registration can still sign out.
 */
export const logoutDeviceSchema = z.object({
  /** Web-push endpoint (a capability URL unique to this browser profile). */
  endpoint: z.string().url().max(2000).optional(),
  /** FCM/APNs device token from the native shell. */
  token: z.string().min(10).max(500).optional(),
  platform: z.enum(["android", "ios"]).optional(),
});
