import { z } from "zod";

// The crew profile catalogue lives in the admin schemas (it is edited from the
// admin user desk); it is re-exported here so the crew domain has one import.
export {
  CREW_TRADES,
  CREW_EMPLOYMENT_TYPES,
  CREW_AVAILABILITY,
  CREW_TRADE_LABELS,
  crewProfileSchema,
  type CrewProfileInput,
} from "@/lib/validations/admin";

import {
  CREW_AVAILABILITY,
  CREW_EMPLOYMENT_TYPES,
  CREW_TRADES,
} from "@/lib/validations/admin";
import { optionalReadableText } from "@/lib/validations/text";

/** Optional ISO-8601 instant; a blank form field counts as "not provided". */
function optionalDateTime(label: string) {
  return z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    z.coerce
      .date({ message: `${label} is not a valid date and time.` })
      .optional()
  );
}

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .optional()
    .transform((value) => (value === "" ? undefined : value));

/**
 * POST /api/v1/concerns/[id]/crew — assign named crew.
 * Up to 20 people at a time; each is checked against the plan and against
 * their other bookings by the service.
 */
export const crewAssignmentSchema = z
  .object({
    crewIds: z
      .array(z.coerce.number().int().positive())
      .min(1, "Select at least one crew member.")
      .max(20, "Assign at most 20 crew members at a time."),
    taskNote: optionalText(300, "Task note is too long."),
    scheduledStartAt: optionalDateTime("Planned start"),
    scheduledEndAt: optionalDateTime("Planned finish"),
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
  );

export type CrewAssignmentBody = z.infer<typeof crewAssignmentSchema>;

/** DELETE /api/v1/concerns/[id]/crew — release one person, with a reason. */
export const crewReleaseSchema = z.object({
  crewId: z.coerce.number().int().positive(),
  reason: z
    .string()
    .trim()
    .min(5, "Give a short reason for the release (at least 5 characters).")
    .max(300, "Reason is too long."),
});

export type CrewReleaseBody = z.infer<typeof crewReleaseSchema>;

/**
 * POST /api/v1/admin/crew — create or update a roster entry.
 *
 * Trade and employment type are closed lists, not free text: a roster row that
 * says "ASTROLOGY" can never be matched against the trades the assignment
 * picker filters on. A blank value still means "not set" (the desk sends "" when
 * the select is left alone), so it is preprocessed away instead of rejected.
 */
const blankToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

export const crewRosterUpsertSchema = z.object({
  userId: z.coerce.number().int().positive(),
  trade: z.preprocess(
    blankToUndefined,
    z.enum(CREW_TRADES, "That is not one of the configured trades.").optional()
  ),
  employmentType: z.preprocess(
    blankToUndefined,
    z.enum(CREW_EMPLOYMENT_TYPES, "That is not one of the employment types.").optional()
  ),
  hourlyRate: z.coerce.number().min(0).max(100000).nullable().optional(),
  dailyRate: z.coerce.number().min(0).max(100000).nullable().optional(),
  availability: z.enum(CREW_AVAILABILITY).optional(),
  maxConcurrentCases: z.coerce.number().int().min(1).max(10).optional(),
  officeId: z.coerce.number().int().positive().nullable().optional(),
  notes: z.preprocess(
    blankToUndefined,
    optionalReadableText("Notes", 500)
  ),
  isActive: z.boolean().optional(),
});

export type CrewRosterUpsertBody = z.infer<typeof crewRosterUpsertSchema>;

/** POST /api/v1/crew/jobs/[id] — a crew member's own progress note. */
export const crewJobUpdateSchema = z.object({
  kind: z.enum(["PROGRESS", "PROBLEM", "COMPLETION"]),
  note: z
    .string()
    .trim()
    .min(5, "Describe the update (at least 5 characters).")
    .max(500, "Note is too long."),
});

export type CrewJobUpdateBody = z.infer<typeof crewJobUpdateSchema>;
