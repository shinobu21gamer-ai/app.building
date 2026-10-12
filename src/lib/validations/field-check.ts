import { z } from "zod";
import {
  FIELD_CHECK_FINDINGS,
  FIELD_CHECK_REVIEW_DECISIONS,
} from "@/lib/cases/field-check-rules";

export const requestFieldCheckSchema = z.object({
  assigneeId: z.coerce
    .number()
    .int("Choose who should do the check.")
    .positive("Choose who should do the check."),
  instructions: z
    .string()
    .trim()
    .min(10, "Say what to confirm on site (at least 10 characters).")
    .max(500, "The instructions are too long."),
});

export const submitFieldCheckSchema = z.object({
  finding: z.enum(FIELD_CHECK_FINDINGS, {
    message: "Choose what you found.",
  }),
  notes: z
    .string()
    .trim()
    .max(1000, "The notes are too long.")
    .optional()
    .nullable(),
});

export const reviewFieldCheckSchema = z
  .object({
    decision: z.enum(FIELD_CHECK_REVIEW_DECISIONS, {
      message: "Choose approve or send back.",
    }),
    note: z.string().trim().max(1000, "The note is too long.").optional().nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.decision === "REQUEST_RECHECK" && (value.note ?? "").length < 5) {
      ctx.addIssue({
        code: "custom",
        path: ["note"],
        message: "Say what needs checking again (at least 5 characters).",
      });
    }
  });
