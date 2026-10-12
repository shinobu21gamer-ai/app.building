import { z } from "zod";
import { booleanFlag } from "@/lib/validations/boolean";
import { acknowledgment, phoneInputSchema } from "@/lib/validations/privacy";

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(255, "Email is too long.")
  .email("Enter a valid email address.");

const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(128, "Password is too long.")
  .regex(/[a-z]/, "Password must contain a lowercase letter.")
  .regex(/[A-Z]/, "Password must contain an uppercase letter.")
  .regex(/[0-9]/, "Password must contain a number.");

const nameSchema = z
  .string()
  .trim()
  .min(2, "Must be at least 2 characters.")
  .max(80, "Must be at most 80 characters.");

const optionalString = z
  .string()
  .trim()
  .max(255)
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

/**
 * Registration.
 *
 * RA 10173 requires the resident to agree to the processing of their personal
 * data before the account exists, so `consentDataProcessing` and
 * `consentPrivacyNotice` are mandatory acknowledgements (see
 * src/lib/privacy/catalog.ts). The other consents are optional and may be
 * withdrawn later from the privacy page.
 */
export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  firstName: nameSchema,
  lastName: nameSchema,
  phone: phoneInputSchema,
  address: optionalString,
  consentDataProcessing: acknowledgment(
    "Agree to the processing of your personal data to handle your concerns."
  ),
  consentPrivacyNotice: acknowledgment(
    "Confirm that you have read the privacy notice."
  ),
  consentTransparencyPublication: booleanFlag.optional(),
  consentNotifications: booleanFlag.optional(),
  consentSms: booleanFlag.optional(),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required."),
});

export const updateProfileSchema = z
  .object({
    firstName: nameSchema.optional(),
    lastName: nameSchema.optional(),
    // Omitted = "leave my number as it is". A posted value is normalised,
    // encrypted and only ever read back masked.
    phone: phoneInputSchema,
    address: optionalString,
    position: optionalString,
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be provided.",
  });

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required."),
  newPassword: passwordSchema,
});

export const resetPasswordSchema = z.object({
  email: emailSchema,
  code: z
    .string()
    .trim()
    .min(8, "Enter the reset code exactly as shown.")
    .max(16, "Reset code is too long."),
  newPassword: passwordSchema,
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;