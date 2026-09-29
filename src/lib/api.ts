import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { logApiError, logApiRequest, generateRequestId } from "@/lib/logger";
import { requestMeta } from "@/lib/audit";

/**
 * Uniform API error used across all route handlers.
 * Route handlers should throw ApiError for expected failures and let
 * the withErrorBoundary wrapper convert it into a JSON response.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    public readonly headers?: Record<string, string>
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const HttpStatus = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_ERROR: 500,
} as const;

/** Convenience factory for common errors. */
export const createApiError = {
  badRequest: (message: string, details?: unknown) =>
    new ApiError(HttpStatus.BAD_REQUEST, "BAD_REQUEST", message, details),
  unauthorized: (message = "Authentication required.") =>
    new ApiError(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", message),
  forbidden: (message = "You do not have permission to perform this action.") =>
    new ApiError(HttpStatus.FORBIDDEN, "FORBIDDEN", message),
  notFound: (message = "Resource not found.") =>
    new ApiError(HttpStatus.NOT_FOUND, "NOT_FOUND", message),
  conflict: (message: string) =>
    new ApiError(HttpStatus.CONFLICT, "CONFLICT", message),
  payloadTooLarge: (message = "The uploaded content is too large.") =>
    new ApiError(HttpStatus.PAYLOAD_TOO_LARGE, "PAYLOAD_TOO_LARGE", message),
  tooManyRequests: (
    message = "Too many requests. Please try again later.",
    retryAfterSeconds?: number
  ) =>
    new ApiError(
      HttpStatus.TOO_MANY_REQUESTS,
      "RATE_LIMITED",
      message,
      undefined,
      retryAfterSeconds !== undefined
        ? { "Retry-After": String(Math.max(1, Math.ceil(retryAfterSeconds))) }
        : undefined
    ),
  internal: (message = "An unexpected error occurred.") =>
    new ApiError(HttpStatus.INTERNAL_ERROR, "INTERNAL_ERROR", message),
};

/** Builds a successful JSON response body. */
export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ success: true, data }, init);
}

/**
 * Parses and validates a JSON request body against a Zod schema.
 * Invalid JSON or invalid data becomes a structured 400 error.
 */
export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw createApiError.badRequest("Request body must be valid JSON.");
  }

  const result = schema.safeParse(json);
  if (!result.success) {
    throw new ApiError(
      HttpStatus.BAD_REQUEST,
      "VALIDATION_ERROR",
      "Invalid request data.",
      result.error.issues
    );
  }
  return result.data;
}

/**
 * Rejects cookie-bearing state-changing requests that arrive from a
 * different origin (CSRF defense in depth on top of SameSite=Lax).
 */
export function assertSameOrigin(req: Request): void {
  const origin = req.headers.get("origin");
  if (!origin) return; // non-browser clients do not send Origin

  let requestOrigin: string;
  let expectedOrigin: string;
  try {
    requestOrigin = new URL(origin).origin;
    const requestUrl = new URL(req.url);
    const forwardedHost = req.headers.get("x-forwarded-host");
    const host = forwardedHost ?? req.headers.get("host");
    const forwardedProtocol = req.headers.get("x-forwarded-proto");
    expectedOrigin = host
      ? `${forwardedProtocol ?? requestUrl.protocol.replace(":", "")}://${host}`
      : requestUrl.origin;
  } catch {
    throw createApiError.badRequest("Invalid request origin.");
  }

  if (requestOrigin !== expectedOrigin) {
    throw createApiError.forbidden("Cross-origin request rejected.");
  }
}

/**
 * Converts an unknown thrown error into a JSON error response.
 * Expected ApiError/ZodError become structured responses; anything else
 * is logged for the developer and returned as a generic 500.
 */
export function handleError(error: unknown, requestId = "unknown"): NextResponse {
  if (error instanceof ApiError) {
    const headers: Record<string, string> = { "x-request-id": requestId };
    if (error.headers) Object.assign(headers, error.headers);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: error.code,
          message: error.message,
          ...(error.details !== undefined ? { details: error.details } : {}),
        },
      },
      { status: error.status, headers }
    );
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request data.",
          details: error.issues,
        },
      },
      {
        status: HttpStatus.BAD_REQUEST,
        headers: { "x-request-id": requestId },
      }
    );
  }

  if (error instanceof Error) {
    // Do not leak internal error details to API consumers, but log them
    // (with the correlation id) for the developer.
    logApiError({
      errorName: error.name,
      message: error.message,
      stack: error.stack,
      requestId,
    });
  } else {
    logApiError({
      errorName: "NonError",
      message: "A non-Error value was thrown.",
      requestId,
    });
  }

  return NextResponse.json(
    {
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred.",
      },
    },
    { status: HttpStatus.INTERNAL_ERROR, headers: { "x-request-id": requestId } }
  );
}

/**
 * Wraps a route handler so any thrown error is converted into a consistent
 * JSON error response, and every handled request is logged with a
 * correlation id.
 *
 * Example:
 *   export const GET = withErrorBoundary(async () => ok({ hello: "world" }));
 */
export function withErrorBoundary<A extends unknown[]>(
  handler: (...args: A) => Promise<NextResponse>
): (...args: A) => Promise<NextResponse> {
  return async (...args: A) => {
    const startedAt = Date.now();
    const request = args[0] as Request | undefined;
    const requestId = generateRequestId();

    let response: NextResponse;
    try {
      response = await handler(...args);
    } catch (error) {
      response = handleError(error, requestId);
    }

    const url = request ? new URL(request.url) : null;
    const path = url ? url.pathname : "";
    if (!path.startsWith("/api/v1/health")) {
      logApiRequest({
        method: request?.method ?? null,
        path,
        status: response.status,
        durationMs: Date.now() - startedAt,
        requestId,
        ip: request ? requestMeta(request).ip : null,
      });
    }

    return response;
  };
}