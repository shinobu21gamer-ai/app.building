import { z } from "zod";
export const nativePushStatusSchema = z.object({
  token: z.string().min(10).max(500).nullable(),
  platform: z.enum(["android", "ios"]),
});
export const nativePushTestSchema = z.object({
  token: z.string().min(10).max(500),
  platform: z.literal("android"),
});
