import { z } from "zod";
import { CALENDAR_DAY_RE, isValidCalendarDay } from "@/lib/cases/action-date";
import {
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
