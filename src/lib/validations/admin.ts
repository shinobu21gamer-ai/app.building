import { z } from "zod";
import { booleanFlag } from "@/lib/validations/boolean";

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

const nameSchema = z
  .string()
  .trim()
  .min(2, "Must be at least 2 characters.")
  .max(80, "Must be at most 80 characters.");

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

export const ADMIN_ROLE_KEYS = ["RESIDENT", "OFFICIAL", "ADMIN"] as const;
export type AdminRoleKey = (typeof ADMIN_ROLE_KEYS)[number];

// ---------------------------------------------------------------
// Users / officials
// ---------------------------------------------------------------

export const adminUserCreateSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  firstName: nameSchema,
  lastName: nameSchema,
  phone: optionalText(40),
  address: optionalText(255),
  roleKey: z.enum(ADMIN_ROLE_KEYS),
  officeId: nullableId.optional(),
  isActive: booleanFlag.optional(),
});

export const adminUserUpdateSchema = z
  .object({
    email: emailSchema.optional(),
    password: passwordSchema.optional(),
    firstName: nameSchema.optional(),
    lastName: nameSchema.optional(),
    phone: optionalText(40),
    address: optionalText(255),
    roleKey: z.enum(ADMIN_ROLE_KEYS).optional(),
    officeId: nullableId.optional(),
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

export const officeCreateSchema = z.object({
  name: z.string().trim().min(2, "Name is too short.").max(120, "Name is too long."),
  code: codeSchema,
  description: optionalText(500),
  headOfficer: optionalText(120),
  contact: optionalText(120),
  isActive: booleanFlag.optional(),
});

export const officeUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    code: codeSchema.optional(),
    description: optionalText(500),
    headOfficer: optionalText(120),
    contact: optionalText(120),
    isActive: booleanFlag.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to update.",
  });

// ---------------------------------------------------------------
// Concern categories
// ---------------------------------------------------------------

export const categoryCreateSchema = z.object({
  name: z.string().trim().min(2, "Name is too short.").max(120, "Name is too long."),
  code: codeSchema,
  description: optionalText(500),
  isActive: booleanFlag.optional(),
});

export const categoryUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
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
