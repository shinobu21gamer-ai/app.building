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
