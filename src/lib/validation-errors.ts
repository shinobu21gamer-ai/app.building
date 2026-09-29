import type { ApiResult } from "@/lib/api-client";

type ZodIssueLike = {
  path?: (string | number)[];
  message?: string;
};

/** Maps server-side Zod validation issues to a per-field error map. */
export function extractFieldErrors(
  details: unknown
): Record<string, string> {
  const result: Record<string, string> = {};
  if (!Array.isArray(details)) return result;

  for (const issue of details as ZodIssueLike[]) {
    const field = issue.path?.[0];
    if (typeof field === "string" && typeof issue.message === "string") {
      if (!result[field]) result[field] = issue.message;
    }
  }
  return result;
}

/** Convenience: pulls the first error out of an ApiResult for display. */
export function firstError(
  result: Extract<ApiResult<unknown>, { success: false }> | null
): string | null {
  return result?.success === false ? result.error.message : null;
}

export function isValidationError(
  result: Extract<ApiResult<unknown>, { success: false }>
): boolean {
  return result.error.code === "VALIDATION_ERROR";
}