import { z } from "zod";

export const createConcernSchema = z.object({
  title: z
    .string()
    .trim()
    .min(5, "Title must be at least 5 characters.")
    .max(150, "Title is too long."),
  description: z
    .string()
    .trim()
    .min(10, "Description must be at least 10 characters.")
    .max(2000, "Description is too long."),
  locationAddress: z
    .string()
    .trim()
    .min(3, "Location is required.")
    .max(255, "Location is too long."),
  categoryId: z.coerce
    .number()
    .int("Select a valid category.")
    .positive("Select a valid category."),
  locationLat: z.coerce
    .number()
    .min(-90, "Latitude is out of range.")
    .max(90, "Latitude is out of range.")
    .optional(),
  locationLng: z.coerce
    .number()
    .min(-180, "Longitude is out of range.")
    .max(180, "Longitude is out of range.")
    .optional(),
  // Rule-engine factor inputs. Bounds are enforced by the engine against the
  // administrator-configured factor ranges, not hard-coded here.
  urgencyScore: z.coerce.number(),
  impactScore: z.coerce.number(),
  affectedPopulationScore: z.coerce.number(),
  safetyScore: z.coerce.number(),
});

export type CreateConcernInput = z.infer<typeof createConcernSchema>;

/** Public status lookup: case number plus the submitter's account email. */
export const CASE_NUMBER_RE = /^BR-\d{8}-\d{4,}$/;

export const trackConcernSchema = z.object({
  caseNumber: z
    .string()
    .trim()
    .toUpperCase()
    .regex(CASE_NUMBER_RE, "Enter a case number like BR-20261009-0001."),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(255, "Email is too long.")
    .email("Enter a valid email address."),
});

export type TrackConcernInput = z.infer<typeof trackConcernSchema>;
