import { z } from "zod";
import { CALENDAR_DAY_RE, isValidCalendarDay } from "@/lib/cases/action-date";
import {
  MAX_DURATION_MINUTES,
  MAX_WORKERS_NEEDED,
} from "@/lib/cases/manpower";
import {
  CREATABLE_OVERRIDE_KINDS,
  OVERRIDE_REASON_MIN,
  PRIORITY_LEVELS,
  RESOLUTION_TYPES,
  WORKFLOW_TARGET_STATUSES,
} from "@/lib/cases/workflow";

function calendarDayField(label: string) {
  return z
    .string()
    .regex(CALENDAR_DAY_RE, `${label} must be a valid date (YYYY-MM-DD).`)
    .refine(isValidCalendarDay, `${label} must be a real calendar date (YYYY-MM-DD).`);
}

/**
 * An optional calendar day (YYYY-MM-DD). A blank string, such as an untouched
 * form field, counts as "not provided". Routes map an absent form field to
 * undefined before validating, so nulls are rejected here like any other type.
 */
function optionalCalendarDay(label: string) {
  return z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    calendarDayField(label).optional()
  );
}

export const resolutionSchema = z.object({
  summary: z
    .string()
    .trim()
    .min(10, "Resolution summary must be at least 10 characters.")
    .max(2000, "Resolution summary is too long."),
  actionsTaken: z
    .string()
    .trim()
    .min(10, "Describe the actions taken (at least 10 characters).")
    .max(2000, "Actions taken is too long."),
  resolutionType: z.enum(RESOLUTION_TYPES),
  // Optional calendar date (YYYY-MM-DD) the issue was actually resolved.
  // Defaults to today; the service applies the timeline rules.
  resolvedOn: optionalCalendarDay("Resolution date"),
});

export const feedbackSchema = z.object({
  wasResolved: z.boolean(),
  rating: z.number().int("Rating must be a whole number.").min(1).max(5),
  comment: z
    .string()
    .trim()
    .max(500, "Feedback comment is too long.")
    .optional(),
});

export const settingsSchema = z.object({
  feedbackResubmissionAllowed: z.boolean(),
});

export const statusChangeSchema = z
  .object({
    status: z.enum(WORKFLOW_TARGET_STATUSES),
    remarks: z
      .string()
      .trim()
      .min(5, "Provide remarks for the status change (at least 5 characters).")
      .max(1000, "Remarks are too long."),
    // Date the status change actually happened. Defaults to today. For RESOLVED
    // the resolution's own resolvedOn is used instead (see the service).
    occurredOn: optionalCalendarDay("Action date"),
    resolution: resolutionSchema.optional(),
    // Written reason for bypassing a workflow rule (crew shortfall, forcing a close). Stored as a CaseWorkflowOverride.
    overrideReason: z
      .string()
      .trim()
      .min(
        OVERRIDE_REASON_MIN,
        `Give a reason of at least ${OVERRIDE_REASON_MIN} characters to override a workflow rule.`
      )
      .max(1000, "Override reason is too long.")
      .optional()
      .or(z.literal("").transform(() => undefined)),
  })
  .refine((value) => value.status !== "RESOLVED" || value.resolution !== undefined, {
    message: "Resolution details are required when resolving a case.",
    path: ["resolution"],
  });

export const caseNoteSchema = z.object({
  kind: z.enum(["REMARK", "ACTION"]),
  remarks: z
    .string()
    .trim()
    .min(5, "Provide at least 5 characters.")
    .max(1000, "Remarks are too long."),
  // Date the remark or action actually happened. Defaults to today.
  occurredOn: optionalCalendarDay("Action date"),
});

export type StatusChangeBody = z.infer<typeof statusChangeSchema>;
export type CaseNoteBody = z.infer<typeof caseNoteSchema>;
export type ResolutionBody = z.infer<typeof resolutionSchema>;
export type FeedbackBody = z.infer<typeof feedbackSchema>;
export type SettingsBody = z.infer<typeof settingsSchema>;

// ---------------------------------------------------------------- assessment
// The UNDER_ASSESSMENT record: the four checks, the manpower plan and the
// labour-inclusive cost estimate. Workers needed, the duration and the
// equipment notes are mandatory — a plan without them is not a plan.

const optionalMoney = (label: string) =>
  z.preprocess(
    (value) =>
      value === null || (typeof value === "string" && value.trim() === "")
        ? undefined
        : value,
    z.coerce
      .number()
      .min(0, `${label} cannot be negative.`)
      .max(10_000_000, `${label} is too large.`)
      .optional()
  );

/** A money figure that may be empty (quantity and unit price are optional). */
const optionalFigure = (label: string) =>
  z.preprocess(
    (value) =>
      value === null ||
      value === undefined ||
      (typeof value === "string" && value.trim() === "")
        ? null
        : value,
    z.coerce
      .number()
      .min(0, `${label} cannot be negative.`)
      .max(10_000_000, `${label} is too large.`)
      .nullable()
  );


const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .optional()
    .transform((value) => (value === "" ? undefined : value));

// One line of the materials list in a cost estimate: what will be bought,
// how much of it, at what price, and what the line costs.
export const materialLineSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Each material needs a name.")
    .max(160, "Material names are too long."),
  quantity: optionalFigure("A material quantity"),
  unit: z
    .string()
    .trim()
    .max(24, "Material units are too long.")
    .optional()
    .transform((value) => (value === undefined || value === "" ? null : value)),
  unitPrice: optionalFigure("A material unit price"),
  amount: z.coerce
    .number()
    .min(0, "Material amounts cannot be negative.")
    .max(10_000_000, "A material amount is too large."),
  note: optionalText(200, "Material notes are too long."),
});

// One line of the equipment list: WHAT goes to the site (or is rented),
// how much of it / for how long, at what rate, and what the line costs.
export const equipmentLineSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Each piece of equipment needs a name.")
    .max(160, "Equipment names are too long."),
  quantity: optionalFigure("An equipment quantity"),
  unit: z
    .string()
    .trim()
    .max(24, "Equipment units are too long.")
    .optional()
    .transform((value) => (value === undefined || value === "" ? null : value)),
  unitPrice: optionalFigure("An equipment rate"),
  amount: z.coerce
    .number()
    .min(0, "Equipment amounts cannot be negative.")
    .max(10_000_000, "An equipment amount is too large."),
  note: optionalText(200, "Equipment notes are too long."),
});
const optionalInstant = (label: string) =>
  z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    z.coerce
      .date({ message: `${label} is not a valid date and time.` })
      .optional()
  );

export const assessmentSchema = z
  .object({
    // The four checks.
    eligibilityChecked: z.boolean(),
    eligibilityNotes: optionalText(1000, "Eligibility notes are too long."),
    inspectionRequired: z.boolean(),
    inspectionNotes: optionalText(1000, "Inspection notes are too long."),
    inspectionCompleted: z.boolean().optional().default(false),
    resourcesVerified: z.boolean(),
    resourcesVerificationNotes: optionalText(
      1000,
      "Resource verification notes are too long."
    ),
    approvalRequired: z.boolean(),
    approvalNotes: optionalText(1000, "Approval notes are too long."),
    approved: z.boolean().optional().default(false),

    // Manpower plan (mandatory).
    workersNeeded: z.coerce
      .number()
      .int("Workers needed must be a whole number.")
      .min(0, "Workers needed cannot be negative.")
      .max(MAX_WORKERS_NEEDED, `At most ${MAX_WORKERS_NEEDED} workers.`),
    estimatedDurationMinutes: z.coerce
      .number()
      .int("The estimated duration must be a whole number of minutes.")
      .min(15, "The estimated duration must be at least 15 minutes.")
      .max(
        MAX_DURATION_MINUTES,
        "The estimated duration cannot exceed 90 days."
      ),
    equipmentNotes: z
      .string()
      .trim()
      .max(500, "Equipment notes are too long.")
      .optional()
      .transform((value) => value || "none"),
    scheduledStartAt: optionalInstant("Planned start"),
    scheduledEndAt: optionalInstant("Planned finish"),

    // Cost estimate. Labour is computed from crew rates when available.
    laborCost: optionalMoney("Labour cost"),
    materialsCost: optionalMoney("Materials cost"),
    equipmentCost: optionalMoney("Equipment cost"),
    otherCost: optionalMoney("Other cost"),
    // The materials list. When present (even empty), the materials total is
    // recomputed from these lines instead of taking `materialsCost`.
    materials: z
      .array(materialLineSchema)
      .max(100, "Too many material lines.")
      .optional(),
    // The equipment list, same contract: when present (even empty), the
    // equipment total is recomputed from these lines instead of taking
    // `equipmentCost`.
    equipment: z
      .array(equipmentLineSchema)
      .max(100, "Too many equipment lines.")
      .optional(),
  })
  .refine(
    (value) =>
      !value.scheduledStartAt ||
      !value.scheduledEndAt ||
      value.scheduledEndAt.getTime() > value.scheduledStartAt.getTime(),
    {
      message: "The planned finish must be after the planned start.",
      path: ["scheduledEndAt"],
    }
  )
  .refine((value) => value.inspectionRequired || !value.inspectionCompleted, {
    message: "An inspection cannot be completed when none was required.",
    path: ["inspectionCompleted"],
  });

export type AssessmentBody = z.infer<typeof assessmentSchema>;

// ------------------------------------------------------------ admin validation

export const concernValidationSchema = z.object({
  typeId: z.coerce
    .number()
    .int("Select a valid concern type.")
    .positive("Select a valid concern type."),
  categoryId: z.coerce
    .number({ message: "Choose the category that best matches this concern." })
    .int("Choose a valid category.")
    .positive("Choose the category that best matches this concern."),
  priorityLevel: z
    .enum(PRIORITY_LEVELS)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  notes: z
    .string()
    .trim()
    .min(5, "Add a validation note (at least 5 characters).")
    .max(1000, "Validation notes are too long."),
  confirmPriority: z.boolean(),
});

export type ConcernValidationBody = z.infer<typeof concernValidationSchema>;

// ------------------------------------------------------------ overrides

export const workflowOverrideSchema = z.object({
  kind: z.enum(CREATABLE_OVERRIDE_KINDS),
  reason: z
    .string()
    .trim()
    .min(
      OVERRIDE_REASON_MIN,
      `A reason of at least ${OVERRIDE_REASON_MIN} characters is required.`
    )
    .max(1000, "Reason is too long."),
  details: z.record(z.string(), z.unknown()).optional(),
});

export type WorkflowOverrideBody = z.infer<typeof workflowOverrideSchema>;

// ------------------------------------------------------------ verification

export const resolutionVerificationSchema = z.object({
  verificationStatus: z.enum([
    "FIXED_VERIFIED",
    "PARTIALLY_VERIFIED",
    "FAILED",
    "PENDING_RESIDENT_CONFIRMATION",
  ]),
  notes: z
    .string()
    .trim()
    .min(10, "Describe what was verified (at least 10 characters).")
    .max(1000, "Verification notes are too long."),
});

export type ResolutionVerificationBody = z.infer<
  typeof resolutionVerificationSchema
>;
