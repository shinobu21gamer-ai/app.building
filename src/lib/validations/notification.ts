import { z } from "zod";

export const loginAlertReportSchema = z.object({
  report: z.literal(true),
});

export const notificationUpdateSchema = z.object({
  isRead: z.boolean().optional().default(true),
});

export type NotificationUpdateInput = z.infer<
  typeof notificationUpdateSchema
>;
