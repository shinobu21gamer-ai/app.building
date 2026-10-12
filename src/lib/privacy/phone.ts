// Phone number handling for RA 10173 compliance.
//
// A phone number is personal data: it is stored encrypted (see crypto.ts),
// looked up through a keyed hash, and displayed masked — `+63 9••••••4567` —
// unless an administrator explicitly unmasks it with a recorded reason
// (privacy.pii_access.view, logged in PiiAccessLog).

import { tail } from "@/lib/privacy/crypto";

export const PH_MOBILE_DIGITS = 10; // 9XXXXXXXXX, without the country code
const PH_COUNTRY_CODE = "+63";

/**
 * Normalises a Philippine **mobile** number to `+63XXXXXXXXXX` (ten national
 * digits: 9XX XXX XXXX).
 *
 * Accepts the shapes people actually type:
 *   +639171234567, 639171234567, 09171234567, 9171234567,
 *   0917 123 4567, (0917) 123-4567, +63 917 123 4567
 *
 * Returns null when the value cannot be a Philippine mobile number. Landlines
 * are deliberately not accepted: the number is used for case updates and the
 * barangay contacts residents on mobile, so a fixed line would be stored
 * believing it can receive updates.
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (typeof input !== "string") return null;

  const hasPlus = input.trim().startsWith("+");
  const digits = input.replace(/[^\d]/g, "");
  if (digits === "") return null;

  let national: string | null = null;

  if (hasPlus) {
    if (digits.startsWith("63") && digits.length === 12) {
      national = digits.slice(2);
    }
  } else if (digits.startsWith("63") && digits.length === 12) {
    national = digits.slice(2);
  } else if (digits.startsWith("09") && digits.length === 11) {
    national = digits.slice(1);
  } else if (digits.length === PH_MOBILE_DIGITS && digits.startsWith("9")) {
    national = digits;
  }

  if (!national || national.length !== PH_MOBILE_DIGITS) return null;
  if (!national.startsWith("9")) return null;

  return `${PH_COUNTRY_CODE}${national}`;
}

export function isNormalizedPhone(value: string | null | undefined): boolean {
  return typeof value === "string" && /^\+63\d{10}$/.test(value);
}

/**
 * Display form for staff screens and API responses. Never returns the full
 * number: the last four digits are the only ones shown, and the network
 * prefix is reduced to its first digit.
 *
 * `+639171234567` → `+63 9••••••4567`
 *
 * A value that is not a recognisable mobile number is still masked (only its
 * last four characters survive) rather than echoed back.
 */
export function maskPhone(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;

  const normalized = normalizePhone(trimmed);
  if (!normalized) {
    const lastFour = tail(trimmed, 4);
    return lastFour && trimmed.length > 4 ? `••••${lastFour}` : "••••";
  }

  const national = normalized.slice(PH_COUNTRY_CODE.length);
  return `${PH_COUNTRY_CODE} ${national.slice(0, 1)}${"•".repeat(6)}${national.slice(-4)}`;
}

/** The only part of a phone number staff may see: its last four digits. */
export function phoneLast4(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = normalizePhone(value);
  return tail(normalized ?? value, 4);
}

/** Digits only, for search inputs (`0917…` → `917…`). */
export function phoneDigits(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  return value.replace(/[^\d]/g, "");
}
