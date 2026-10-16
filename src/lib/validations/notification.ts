import { z } from "zod";

export const loginAlertDecisionSchema = z.object({
  wasMe: z.boolean(),
});

export const notificationUpdateSchema = z.object({
  isRead: z.boolean().optional().default(true),
});

export type NotificationUpdateInput = z.infer<
  typeof notificationUpdateSchema
>;
