import { z } from "zod";
import {
  RESOLUTION_TYPES,
  WORKFLOW_TARGET_STATUSES,
} from "@/lib/cases/workflow";

export const RESOLUTION_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isValidCalendarDate(value: string): boolean {
  const match = RESOLUTION_DATE_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
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
  resolvedOn: z
    .string()
    .regex(RESOLUTION_DATE_RE, "Resolution date must be a valid date (YYYY-MM-DD).")
    .refine(
      isValidCalendarDate,
      "Resolution date must be a real calendar date (YYYY-MM-DD)."
    )
    .optional(),
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
});

export type StatusChangeBody = z.infer<typeof statusChangeSchema>;
export type CaseNoteBody = z.infer<typeof caseNoteSchema>;
export type ResolutionBody = z.infer<typeof resolutionSchema>;
export type FeedbackBody = z.infer<typeof feedbackSchema>;
export type SettingsBody = z.infer<typeof settingsSchema>;
