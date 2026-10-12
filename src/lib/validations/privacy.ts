import { z } from "zod";
import { booleanFlag } from "@/lib/validations/boolean";
import { normalizePhone } from "@/lib/privacy/phone";
import {
  CONSENT_PURPOSES,
  DSR_STATUSES,
  DSR_TYPES,
} from "@/lib/privacy/catalog";
import { ID_METHODS } from "@/lib/identity/policy";

// --------------------------------------------------------- shared helpers

function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max, `Must be at most ${max} characters.`)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .optional();
}

function requiredText(min: number, max: number, message: string) {
  return z.string().trim().min(min, message).max(max, "Too long.");
}

/**
 * Philippine mobile number input (the number the barangay texts case updates
 * to). Values are normalised to `+63XXXXXXXXXX` before they reach the
 * database, and the shape is checked here so a mistyped number is rejected at
 * the edge instead of being encrypted and discovered later. An empty string or
 * an omitted key both mean "no number" (`null`).
 */
export const phoneInputSchema = z
  .string()
  .trim()
  .max(40, "Phone number is too long.")
  .refine(
    (value) => value === "" || normalizePhone(value) !== null,
    "Enter a valid Philippine mobile number, for example 0917 123 4567."
  )
  .transform((value) => (value === "" ? null : normalizePhone(value)))
  .nullable()
  .optional();

/** A checkbox that must be ticked: `true`, never the string "false". */
export function acknowledgment(message: string) {
  return booleanFlag.refine((value) => value === true, message);
}

// ---------------------------------------------------------------- consent

export const consentGrantSchema = z.object({
  purpose: z.enum(CONSENT_PURPOSES),
  notes: optionalText(300),
});

export const consentWithdrawSchema = z.object({
  purpose: z.enum(CONSENT_PURPOSES),
  notes: optionalText(300),
});

export type ConsentGrantInput = z.infer<typeof consentGrantSchema>;
export type ConsentWithdrawInput = z.infer<typeof consentWithdrawSchema>;

// --------------------------------------------------- data subject requests

export const dsrCreateSchema = z.object({
  type: z.enum(DSR_TYPES),
  details: optionalText(2000),
  confirmIdentity: acknowledgment(
    "Confirm that this request is about your own personal data."
  ),
});

export const dsrUpdateSchema = z
  .object({
    status: z.enum(DSR_STATUSES.filter((status) => status !== "RECEIVED")),
    resolutionNotes: optionalText(2000),
    denialReason: optionalText(500),
  })
  .refine(
    (value) =>
      value.status !== "COMPLETED" ||
      (value.resolutionNotes ?? "").trim().length >= 10,
    {
      message: "Describe what was done before completing the request.",
      path: ["resolutionNotes"],
    }
  )
  .refine(
    (value) =>
      value.status !== "REJECTED" ||
      (value.denialReason ?? "").trim().length >= 5,
    {
      message: "Give the legal or factual reason for the denial.",
      path: ["denialReason"],
    }
  );

export type DsrCreateInput = z.infer<typeof dsrCreateSchema>;
export type DsrUpdateInput = z.infer<typeof dsrUpdateSchema>;

// ----------------------------------------------------- identity submission

export const identitySubmitSchema = z
  .object({
    method: z.enum(ID_METHODS),
    idTypeLabel: optionalText(80),
    idNumber: z
      .string()
      .trim()
      .min(4, "Enter the ID number exactly as printed.")
      .max(40, "ID number is too long.")
      .regex(
        /^[A-Za-z0-9][A-Za-z0-9 -]*$/,
        "Use letters, digits, spaces and dashes only."
      ),
    confirmAccuracy: acknowledgment(
      "Confirm that the details match your identity document."
    ),
    consentIdVerification: acknowledgment(
      "Agree to the processing of your identity document for verification."
    ),
  })
  .refine(
    (value) => value.method !== "OTHER" || (value.idTypeLabel ?? "") !== "",
    {
      message: "Name the type of ID you are submitting.",
      path: ["idTypeLabel"],
    }
  );

export const identityReviewSchema = z
  .object({
    decision: z.enum(["VERIFIED", "REJECTED"]),
    reason: optionalText(500),
    expiresAt: z.coerce.date().optional(),
  })
  .refine(
    (value) =>
      value.decision !== "REJECTED" || (value.reason ?? "").trim().length >= 3,
    {
      message: "Tell the resident why the document could not be accepted.",
      path: ["reason"],
    }
  );

export type IdentitySubmitInput = z.infer<typeof identitySubmitSchema>;
export type IdentityReviewInput = z.infer<typeof identityReviewSchema>;

// ------------------------------------------------------------- PII reveal

export const piiRevealSchema = z.object({
  subjectUserId: z.coerce
    .number()
    .int("Select a resident.")
    .positive("Select a resident."),
  reason: requiredText(
    5,
    300,
    "Give a reason for viewing the full number (it is recorded in the privacy log)."
  ),
});

export type PiiRevealInput = z.infer<typeof piiRevealSchema>;
