import { createApiError } from "@/lib/api";
import { RESOLUTION_DATE_RE } from "@/lib/validations/case";

/**
 * Normalizes a resolution date (calendar day in Asia/Manila, YYYY-MM-DD) to a
 * Date at fiscal midday so the day cannot drift across timezone boundaries.
 * Nullable: when the caller omits the date, `undefined` is returned and the
 * caller falls back to the record time.
 */
export function resolveResolutionDate(value: string): Date {
  const todayParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  if (value > todayParts) {
    throw createApiError.badRequest(
      "The resolution date cannot be in the future."
    );
  }
  const date = new Date(`${value}T12:00:00+08:00`);
  if (!RESOLUTION_DATE_RE.test(value) || Number.isNaN(date.getTime())) {
    throw createApiError.badRequest(
      "Resolution date must be a valid calendar date (YYYY-MM-DD)."
    );
  }
  return date;
}