import { z } from "zod";
import { booleanFlag } from "@/lib/validations/boolean";

export const routingRuleCreateSchema = z.object({
  categoryId: z.coerce
    .number()
    .int("Select a valid category.")
    .positive("Select a valid category."),
  officeId: z.coerce
    .number()
    .int("Select a valid office.")
    .positive("Select a valid office."),
  priorityOrder: z.coerce
    .number()
    .int("Priority order must be a whole number.")
    .min(0)
    .max(1000)
    .optional(),
  isActive: booleanFlag.optional(),
});

export const routingRuleUpdateSchema = z
  .object({
    categoryId: z.coerce.number().int().positive().optional(),
    officeId: z.coerce.number().int().positive().optional(),
    priorityOrder: z.coerce.number().int().min(0).max(1000).optional(),
    isActive: booleanFlag.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to update.",
  });

export const reassignSchema = z.object({
  officeId: z.coerce
    .number()
    .int("Select a valid office.")
    .positive("Select a valid office."),
  officialId: z.coerce
    .number()
    .int()
    .positive("Select a valid official.")
    .optional()
    .nullable(),
  reason: z
    .string()
    .trim()
    .min(5, "Provide a reason for the assignment (at least 5 characters).")
    .max(500, "Reason is too long."),
});

export type RoutingRuleCreateInput = z.infer<typeof routingRuleCreateSchema>;
export type RoutingRuleUpdateInput = z.infer<typeof routingRuleUpdateSchema>;
export type ReassignInputBody = z.infer<typeof reassignSchema>;
