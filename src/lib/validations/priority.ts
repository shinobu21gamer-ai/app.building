import { z } from "zod";
import { FACTOR_KEYS } from "@/lib/priority/engine";
import { PRIORITY_LEVELS } from "@/lib/cases/workflow";
import { booleanFlag } from "@/lib/validations/boolean";

export const factorInputSchema = z.object({
  key: z.enum(FACTOR_KEYS),
  label: z.string().trim().min(1, "A label is required.").max(80),
  description: z.string().trim().max(255).optional().nullable(),
  weight: z.coerce
    .number()
    .int("Weight must be a whole number.")
    .min(1, "Weight must be at least 1.")
    .max(100, "Weight is too large."),
  minScore: z.coerce
    .number()
    .int("Minimum must be a whole number.")
    .min(0, "Minimum cannot be negative.")
    .max(1000),
  maxScore: z.coerce
    .number()
    .int("Maximum must be a whole number.")
    .min(0)
    .max(1000),
  displayOrder: z.coerce.number().int().min(0).max(100).optional(),
  isActive: booleanFlag.optional(),
});

export const thresholdInputSchema = z.object({
  level: z.enum(PRIORITY_LEVELS, {
    error: "Priority level must be one of the configured system levels.",
  }),
  minScore: z.coerce.number().int().min(0).max(10000),
  maxScore: z.coerce.number().int().min(0).max(10000),
  label: z.string().trim().max(80).optional().nullable(),
});

export const priorityConfigSchema = z.object({
  thresholds: z
    .array(thresholdInputSchema)
    .min(1)
    .max(10)
    .superRefine((thresholds, ctx) => {
      const seen = new Set<string>();
      thresholds.forEach((threshold, index) => {
        if (seen.has(threshold.level)) {
          ctx.addIssue({
            code: "custom",
            path: [index, "level"],
            message: "Each priority level may appear only once.",
          });
        }
        seen.add(threshold.level);
      });
    }),
  factors: z
    .array(factorInputSchema)
    .min(1)
    .max(10)
    .superRefine((factors, ctx) => {
      const seen = new Set<string>();
      factors.forEach((factor, index) => {
        if (seen.has(factor.key)) {
          ctx.addIssue({
            code: "custom",
            path: [index, "key"],
            message: "Each scoring factor may appear only once.",
          });
        }
        seen.add(factor.key);
      });
    }),
});

export const priorityOverrideSchema = z.object({
  urgencyScore: z.coerce.number().int().optional(),
  impactScore: z.coerce.number().int().optional(),
  affectedPopulationScore: z.coerce.number().int().optional(),
  safetyScore: z.coerce.number().int().optional(),
  levelOverride: z.enum(PRIORITY_LEVELS).optional().nullable(),
  reason: z
    .string()
    .trim()
    .min(5, "Provide a reason for the override (at least 5 characters).")
    .max(500, "Reason is too long."),
});

export type PriorityConfigBody = z.infer<typeof priorityConfigSchema>;
export type PriorityOverrideInput = z.infer<typeof priorityOverrideSchema>;
