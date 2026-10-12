import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { appendAuditEntry } from "@/lib/audit/store";

export type AuditInput = {
  action: string;
  resourceType: string;
  resourceId?: string;
  description?: string;
  userId?: number | null;
  ip?: string | null;
  userAgent?: string | null;
  /** USER | SYSTEM | CRON | ADMIN — stored as a plain string, like the column. */
  actorRole?: string | null;
};

export type RecordAuditOptions = {
  /**
   * Append inside the caller's transaction. When the business write and its
   * audit row share a transaction they either both land or neither does — a
   * committed write can then never be missing from the chain.
   */
  tx?: Prisma.TransactionClient;
  actorRole?: string | null;
};

/**
 * Records an audit entry for traceable actions. Never throws: a failing audit
 * must not break the action it is recording.
 *
 * Every entry is appended to the hash chain (`src/lib/audit/store.ts`); the
 * `seq`, `prevHash` and `hash` columns are assigned here, so call sites keep
 * using the same three-to-six fields they always passed.
 */
export async function recordAudit(
  input: AuditInput,
  options: RecordAuditOptions = {}
): Promise<void> {
  const payload = {
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId ?? null,
    description: input.description ?? null,
    userId: input.userId ?? null,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
    actorRole: options.actorRole ?? input.actorRole ?? null,
  };

  try {
    if (options.tx) {
      await appendAuditEntry(options.tx, payload);
      return;
    }
    await db.$transaction((tx) => appendAuditEntry(tx, payload));
  } catch (error) {
    console.error("[audit] failed to record audit entry:", error);
  }
}

/**
 * Best-effort client metadata. The IP is pulled from the trusted proxy header
 * (cloudflared / Cloudflare sets `cf-connecting-ip`) and falls back to the
 * first `x-forwarded-for` hop only for display purposes. Callers that make
 * security decisions must route the value through `reliableClientIp` first.
 */
export function requestMeta(req: Request): {
  ip: string | null;
  userAgent: string | null;
} {
  const cf = req.headers.get("cf-connecting-ip")?.trim();
  const forwarded =
    req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip");
  return {
    ip: cf && cf !== "" ? cf : forwarded ? forwarded.split(",")[0].trim() : null,
    userAgent: req.headers.get("user-agent"),
  };
}
