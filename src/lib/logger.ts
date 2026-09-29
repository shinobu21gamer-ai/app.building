/**
 * Minimal structured logger. Emits newline-delimited JSON to stdout so logs
 * can be piped into any JSON log collector. Never writes secrets or PII.
 */

function line(
  level: "info" | "warn" | "error",
  event: string,
  fields: Record<string, unknown>
): void {
  const record = {
    ts: new Date().toISOString(),
    level,
    event,
    ...fields,
  };
  if (level === "error") {
    console.error(JSON.stringify(record));
  } else {
    console.log(JSON.stringify(record));
  }
}

export function logApiRequest(input: {
  method: string | null;
  path: string;
  status: number;
  durationMs: number;
  requestId: string;
  ip?: string | null;
  userId?: number | null;
}): void {
  line("info", "api_request", {
    method: input.method,
    path: input.path,
    status: input.status,
    durationMs: input.durationMs,
    requestId: input.requestId,
    ip: input.ip ?? null,
    userId: input.userId ?? null,
  });
}

export function logApiError(input: {
  event?: string;
  errorName: string;
  message: string;
  stack?: string;
  requestId: string;
  path?: string;
}): void {
  line("error", input.event ?? "api_error", {
    errorName: input.errorName,
    message: input.message,
    stack: input.stack ?? null,
    requestId: input.requestId,
    path: input.path ?? null,
  });
}

export function generateRequestId(): string {
  return crypto.randomUUID();
}