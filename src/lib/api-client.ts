export type ApiErrorBody = {
  code: string;
  message: string;
  details?: unknown;
};

export type ApiResult<T> =
  | { success: true; data: T }
  | { success: false; error: ApiErrorBody };

/**
 * Thin client-side wrapper around the backend JSON envelope.
 * Never throws for HTTP errors — returns a structured result instead.
 */
export async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<ApiResult<T>> {
  const isFormData =
    typeof FormData !== "undefined" && options.body instanceof FormData;

  let res: Response;
  try {
    res = await fetch(path, {
      ...options,
      headers: isFormData
        ? { ...(options.headers ?? {}) }
        : {
            "Content-Type": "application/json",
            ...(options.headers ?? {}),
          },
    });
  } catch {
    return {
      success: false,
      error: {
        code: "NETWORK_ERROR",
        message: "Could not reach the server. Please try again.",
      },
    };
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // response had no JSON body
  }

  if (!res.ok || !body || typeof body !== "object" || !("success" in body)) {
    const envelope = body as Partial<{ success: boolean; error: ApiErrorBody }>;
    return {
      success: false,
      error: {
        code: envelope?.error?.code ?? "UNKNOWN_ERROR",
        message: envelope?.error?.message ?? "Something went wrong.",
        details: envelope?.error?.details,
      },
    };
  }

  return body as ApiResult<T>;
}