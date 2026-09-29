export type ClassValue = string | number | null | false | undefined;

/**
 * Tiny className combiner (no external dependency needed by the design system).
 */
export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(" ");
}

export type ApiErrorShape = {
  code: string;
  message: string;
  details?: unknown;
};

/** Flattens the backend error envelope into a single user-facing message,
 *  joining every validation issue when the response carried them. */
export function extractApiError(error: ApiErrorShape): string {
  if (
    error.code === "VALIDATION_ERROR" &&
    Array.isArray(error.details)
  ) {
    const details = error.details as { message: string }[];
    return details.map((detail) => detail.message).join(" ");
  }
  return error.message;
}

/** Resolves a nullable search-params value to a plain string ("" when absent). */
export function firstParam(
  params: Record<string, string | string[] | undefined>,
  key: string
): string {
  const value = params[key];
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}