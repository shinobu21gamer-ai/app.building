import { z } from "zod";

/**
 * Shared text rules for the admin forms.
 *
 * The complaint that started this file: a field like an office name, a head
 * officer or a crew note accepted `"+++"`, `"@"` or `"....."` and saved it. A
 * length check is not enough — text that a person is supposed to read has to
 * carry at least one letter or digit, and a person's name has to look like a
 * name. These schemas are used by the API routes (the real gate) and mirrored
 * by `describeFieldProblem` below so the forms can answer before a round trip.
 */

/** At least one letter or digit: rejects punctuation-only and symbol soup. */
const SUBSTANCE = /[\p{L}\p{N}]/u;

const onlyNoise = (value: string) => !SUBSTANCE.test(value);

/**
 * Letters, marks, spaces and the punctuation real names carry — plus the
 * `ñ`/`é`-style characters MARC and Philippine records use. Digits and signs
 * such as `+`, `@`, `#`, `/` are refused.
 */
const PERSON_NAME = /^[\p{L}\p{M}][\p{L}\p{M}'’.-]*(?: [\p{L}\p{M}'’.-]+)*$/u;

/** A phone number, once spaces, dashes, dots and parentheses are removed. */
const DIALABLE = /^\+?\d{7,15}$/;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const TEXT_MESSAGES = {
  substance: "Use letters or numbers — this cannot be punctuation or symbols only.",
  name: "Use letters only: a name cannot contain numbers or symbols like +, @ or #.",
  contact:
    "Enter a valid phone number (e.g. 0917 123 4567) or email address (e.g. office@barangay.gov.ph).",
} as const;

/**
 * A person's name (first name, last name, head officer).
 *
 * The message names the label so a form with four name fields can say which
 * one is wrong.
 */
export function personNameSchema(label = "Name", max = 80) {
  return z
    .string()
    .trim()
    .min(2, `${label} must be at least 2 characters.`)
    .max(max, `${label} must be at most ${max} characters.`)
    .regex(PERSON_NAME, `${label}: ${TEXT_MESSAGES.name}`);
}

/** Free text that must still read as text (title, description, notes, remarks). */
export function readableTextSchema(label: string, max: number) {
  return z
    .string()
    .trim()
    .min(2, `${label} must be at least 2 characters.`)
    .max(max, `${label} must be at most ${max} characters.`)
    .refine((value) => !onlyNoise(value), {
      message: `${label}: ${TEXT_MESSAGES.substance}`,
    });
}

/** Optional variant: an empty string is "not provided" rather than an error. */
export function optionalReadableText(label: string, max: number) {
  return z
    .string()
    .trim()
    .max(max, `${label} must be at most ${max} characters.`)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .optional()
    .refine((value) => value === null || value === undefined || !onlyNoise(value), {
      message: `${label}: ${TEXT_MESSAGES.substance}`,
    });
}

/** True for `name@host.tld`. */
export function isEmailLike(value: string): boolean {
  return EMAIL.test(value.trim());
}

/**
 * True for a dialable number: PH mobile (`0917 123 4567`, `+63 917 123 4567`),
 * PH landline (`(02) 8888 7777`), or any other 7–15 digit international number.
 */
export function isPhoneLike(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  // Anything with letters is not a phone number; reject before normalising so
  // "call the office" cannot pass as one.
  if (/[\p{L}]/u.test(trimmed)) return false;
  if (/[^\d\s().+-]/.test(trimmed)) return false;
  return DIALABLE.test(trimmed.replace(/[\s().-]/g, ""));
}

/**
 * True for a Philippine **mobile** number — the same acceptance rule as
 * `normalizePhone` in `@/lib/privacy/phone` (which the server-side
 * `phoneInputSchema` applies), mirrored here so a "use client" form can check
 * before the round trip without importing the privacy module, which drags in
 * `node:crypto`. Accepts `+639171234567`, `639171234567`, `09171234567`,
 * `9171234567` and the spaced/dashed variants of each.
 */
export function isPhMobile(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === "") return false;
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (digits === "") return false;

  let national: string | null = null;
  if (hasPlus) {
    if (digits.startsWith("63") && digits.length === 12) {
      national = digits.slice(2);
    }
  } else if (digits.startsWith("63") && digits.length === 12) {
    national = digits.slice(2);
  } else if (digits.startsWith("09") && digits.length === 11) {
    national = digits.slice(1);
  } else if (digits.length === 10 && digits.startsWith("9")) {
    national = digits;
  }

  return national !== null && national.length === 10 && national.startsWith("9");
}

/** An office contact is either an email address or a phone number. */
export function isContactLike(value: string): boolean {
  return isEmailLike(value) || isPhoneLike(value);
}

/**
 * The one contact rule every office goes through: an email address or a phone
 * number, nothing in between. Free-text contacts ("call the front desk") were
 * the loophole that let an office be saved with an unusable contact.
 */
export function officeContactSchema(max = 120) {
  return z
    .string()
    .trim()
    .min(5, TEXT_MESSAGES.contact)
    .max(max, `Contact details must be at most ${max} characters.`)
    .refine(isContactLike, { message: TEXT_MESSAGES.contact });
}

/**
 * Client-side mirror of the rules above: returns the message to show under a
 * field, or null when the value is acceptable. `kind` picks the rule, so a name
 * field and a notes field get the message that explains their own mistake.
 */
export function describeFieldProblem(
  value: string,
  kind: "name" | "text" | "contact",
  label = "This field"
): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (kind === "name") {
    if (trimmed.length < 2) return `${label} must be at least 2 characters.`;
    if (!PERSON_NAME.test(trimmed)) return `${label}: ${TEXT_MESSAGES.name}`;
    return null;
  }
  if (kind === "contact") {
    if (!isContactLike(trimmed)) return TEXT_MESSAGES.contact;
    return null;
  }
  if (onlyNoise(trimmed)) return `${label}: ${TEXT_MESSAGES.substance}`;
  return null;
}
