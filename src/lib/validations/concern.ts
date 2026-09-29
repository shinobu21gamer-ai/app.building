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
