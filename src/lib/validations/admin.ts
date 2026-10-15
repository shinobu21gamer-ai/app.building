import { z } from "zod";
import { booleanFlag } from "@/lib/validations/boolean";
import { phoneInputSchema } from "@/lib/validations/privacy";
import {
  officeContactSchema as contactSchema,
  personNameSchema,
  readableTextSchema,
} from "@/lib/validations/text";
import { ROLE_KEYS, type RoleKey } from "@/lib/auth/roles";

// ---------------------------------------------------------------
// Shared field schemas
// ---------------------------------------------------------------

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

// Staff names go through the person-name rule: letters, spaces and the
// punctuation real names carry. "+++" and "Juan 2" are refused here rather
// than saved as an account name.
const nameSchema = personNameSchema("Name");

function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max, `Must be at most ${max} characters.`)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .optional();
}

const codeSchema = z
  .string()
  .trim()
  .min(2, "Code must be at least 2 characters.")
  .max(30, "Code is too long.")
  .regex(
    /^[A-Za-z0-9_]+$/,
    "Code may only contain letters, numbers, and underscores."
  )
  .transform((value) => value.toUpperCase());

// `null`/empty become null; otherwise a positive integer id.
const nullableId = z.preprocess(
  (value) => (value === "" || value === undefined ? null : value),
  z.coerce.number().int().positive().nullable()
);

export const ADMIN_ROLE_KEYS = ROLE_KEYS;
/** Every role an administrator may assign (the six revamp roles). */
export type AdminRoleKey = RoleKey;

// --------------------------------------------------------- crew profiles

export const CREW_TRADES = [
  "ELECTRICAL",
  "PLUMBING",
  "MASONRY",
  "CARPENTRY",
  "GENERAL",
  "DRIVER",
  "OTHER",
] as const;

export const CREW_EMPLOYMENT_TYPES = [
  "JOB_ORDER",
  "CASUAL",
  "PERMANENT",
  "VOLUNTEER",
] as const;

export const CREW_AVAILABILITY = ["AVAILABLE", "ON_LEAVE", "UNAVAILABLE"] as const;

export const CREW_TRADE_LABELS: Record<(typeof CREW_TRADES)[number], string> = {
  ELECTRICAL: "Electrical",
  PLUMBING: "Plumbing",
  MASONRY: "Masonry",
  CARPENTRY: "Carpentry",
  GENERAL: "General labour",
  DRIVER: "Driver / operator",
  OTHER: "Other",
};

const moneySchema = z.coerce
  .number()
  .nonnegative("Enter a positive amount.")
  .max(1_000_000, "Amount is unrealistically large.");

export const crewProfileSchema = z.object({
  trade: z.enum(CREW_TRADES).optional(),
  employmentType: z.enum(CREW_EMPLOYMENT_TYPES).optional(),
  hourlyRate: moneySchema.nullable().optional(),
  dailyRate: moneySchema.nullable().optional(),
  availability: z.enum(CREW_AVAILABILITY).optional(),
  maxConcurrentCases: z.coerce
    .number()
    .int("Use a whole number.")
    .min(1, "A crew member can hold at least one case.")
    .max(10, "Keep this at 10 or fewer cases.")
    .optional(),
  officeId: nullableId.optional(),
  notes: optionalText(500),
  isActive: booleanFlag.optional(),
});

export type CrewProfileInput = z.infer<typeof crewProfileSchema>;

// ------------------------------------------------- role permission overrides

export const rolePermissionOverrideSchema = z.object({
  roleKey: z.enum(ROLE_KEYS),
  permissionKey: z
    .string()
    .trim()
    .min(3, "Permission key is too short.")
    .max(80, "Permission key is too long."),
  allowed: booleanFlag,
});

export type RolePermissionOverrideInput = z.infer<
  typeof rolePermissionOverrideSchema
>;

// ---------------------------------------------------------------
// Users / officials
// ---------------------------------------------------------------

export const adminUserCreateSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  firstName: nameSchema,
  lastName: nameSchema,
  phone: phoneInputSchema,
  address: optionalText(255),
  position: optionalText(120),
  roleKey: z.enum(ROLE_KEYS),
  officeId: nullableId.optional(),
  crew: crewProfileSchema.optional(),
  isActive: booleanFlag.optional(),
});

export const adminUserUpdateSchema = z
  .object({
    email: emailSchema.optional(),
    password: passwordSchema.optional(),
    firstName: nameSchema.optional(),
    lastName: nameSchema.optional(),
    phone: phoneInputSchema,
    address: optionalText(255),
    position: optionalText(120),
    roleKey: z.enum(ROLE_KEYS).optional(),
    officeId: nullableId.optional(),
    crew: crewProfileSchema.optional(),
    isActive: booleanFlag.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to update.",
  });

export type AdminUserCreateInput = z.infer<typeof adminUserCreateSchema>;
export type AdminUserUpdateInput = z.infer<typeof adminUserUpdateSchema>;

// ---------------------------------------------------------------
// Offices
// ---------------------------------------------------------------

// A contact is a phone number or an email address — not free text. The form
// used to accept "…" or a half-typed number, which produced office cards whose
// contact could not be dialled or written to.
const requiredOfficeContact = contactSchema(120);

// A head officer is a person, but the field is optional; blank means "not
// named yet" and is stored as null.
const optionalHeadOfficer = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  personNameSchema("Head officer", 120).nullable().optional()
);

export const officeCreateSchema = z.object({
  name: readableTextSchema("Office name", 120),
  code: codeSchema,
  description: optionalText(500),
  headOfficer: optionalHeadOfficer,
  contact: requiredOfficeContact,
  isActive: booleanFlag.optional(),
});

export const officeUpdateSchema = z
  .object({
    name: readableTextSchema("Office name", 120).optional(),
    code: codeSchema.optional(),
    description: optionalText(500),
    headOfficer: optionalHeadOfficer,
    contact: requiredOfficeContact.optional(),
    isActive: booleanFlag.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to update.",
  });

// ---------------------------------------------------------------
// Concern categories
// ---------------------------------------------------------------

export const categoryCreateSchema = z.object({
  name: readableTextSchema("Category name", 120),
  code: codeSchema,
  description: optionalText(500),
  isActive: booleanFlag.optional(),
});

export const categoryUpdateSchema = z
  .object({
    name: readableTextSchema("Category name", 120).optional(),
    code: codeSchema.optional(),
    description: optionalText(500),
    isActive: booleanFlag.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to update.",
  });

// ---------------------------------------------------------------
// Application settings
// ---------------------------------------------------------------

export const settingKeySchema = z
  .string()
  .trim()
  .min(2, "Key is too short.")
  .max(100, "Key is too long.")
  .regex(
    /^[A-Za-z0-9]+([._-][A-Za-z0-9]+)*$/,
    "Use letters, numbers, dots, dashes or underscores."
  );

export const settingUpsertSchema = z.object({
  key: settingKeySchema,
  value: z.string().max(1000, "Value is too long."),
});

export const settingDeleteSchema = z.object({
  key: settingKeySchema,
});

export type OfficeCreateInput = z.infer<typeof officeCreateSchema>;
export type OfficeUpdateInput = z.infer<typeof officeUpdateSchema>;
export type CategoryCreateInput = z.infer<typeof categoryCreateSchema>;
export type CategoryUpdateInput = z.infer<typeof categoryUpdateSchema>;
export type SettingUpsertInput = z.infer<typeof settingUpsertSchema>;
