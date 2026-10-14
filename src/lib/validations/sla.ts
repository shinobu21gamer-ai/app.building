import { z } from "zod";
import { ROLE_KEYS } from "@/lib/auth/roles";
import { CASE_STATUSES } from "@/lib/cases/workflow";

// SLA policy intake and the escalation actions. Every field an administrator has
// to fill in is required here (the UI marks those with `*`).

function optionalText(max: number, message?: string) {
  return z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    z.string().trim().max(max, message).optional()
  );
}

function requiredText(label: string, min = 1, max = 160) {
  return z
    .string({ error: `${label} is required.` })
    .trim()
    .min(min, `${label} must be at least ${min} characters.`)
    .max(max, `${label} must be at most ${max} characters.`);
}

/** A role an escalation can be addressed to. */
const escalationRoleSchema = z.enum(ROLE_KEYS);

/**
 * Create or update a policy. `key` is the stable identifier; `stage` is the
 * lifecycle status the clock applies to; leaving `typeId` / `priorityLevel`
 * empty makes the policy a stage-wide default.
 */
export const slaPolicySaveSchema = z.object({
  key: z
    .string({ error: "Key is required." })
    .trim()
    .min(3, "Key must be at least 3 characters.")
    .max(64, "Key must be at most 64 characters.")
    .regex(
      /^[a-z0-9][a-z0-9._-]*$/,
      "Key may use lowercase letters, digits, dot, dash and underscore."
    ),
  name: requiredText("Name", 3, 120),
  stage: z.enum(CASE_STATUSES),
  typeId: z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? null : value,
    z.coerce.number().int("Type must be a whole number.")
      .positive("Type is not valid.").nullable().optional()
  ),
  priorityLevel: z
    .preprocess(
      (value) =>
        typeof value === "string" && value.trim() === "" ? null : value,
      z
        .enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"])
        .nullable()
        .optional()
    ),
  hours: z.coerce
    .number({ error: "Hours is required." })
    .int("Hours must be a whole number.")
    .min(1, "Hours must be at least 1.")
    .max(720, "Hours must be at most 720 (30 days)."),
  escalateToRole: escalationRoleSchema,
  notifyRoles: optionalText(160),
  isActive: z
    .preprocess((value) => {
      if (value === undefined || value === null || value === "") return true;
      if (typeof value === "boolean") return value;
      return ["true", "1", "on", "yes"].includes(String(value).toLowerCase());
    }, z.boolean())
    .default(true),
});

export type SlaPolicySaveInput = z.infer<typeof slaPolicySaveSchema>;

export const slaPolicyToggleSchema = z.object({
  isActive: z.preprocess(
    (value) =>
      typeof value === "boolean"
        ? value
        : ["true", "1", "on", "yes"].includes(String(value).toLowerCase()),
    z.boolean()
  ),
});

/** Acknowledge or resolve one escalation. A note is optional; a resolve is not. */
export const escalationActionSchema = z
  .object({
    action: z.enum(["ACKNOWLEDGE", "RESOLVE"]),
    note: optionalText(500),
  })
  .refine((value) => value.action !== "RESOLVE" || Boolean(value.note), {
    message: "A note is required when closing an escalation.",
    path: ["note"],
  });

export type EscalationActionInput = z.infer<typeof escalationActionSchema>;
