import { db } from "@/lib/db";

type AuditInput = {
  action: string;
  resourceType: string;
  resourceId?: string;
  description?: string;
  userId?: number | null;
  ip?: string | null;
  userAgent?: string | null;
};

/**
 * Records an audit entry for traceable actions. Never throws: a failing
 * audit must not break the action it is recording.
 */
export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await db.audit.create({
      data: {
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId ?? null,
        description: input.description ?? null,
        userId: input.userId ?? null,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
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