import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import {
  assertSameOrigin,
  createApiError,
  ok,
  withErrorBoundary,
} from "@/lib/api";
import { requireApiRole } from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";
import { recordAudit, requestMeta } from "@/lib/audit";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const CODE_EXPIRY_MINUTES = 30;

function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw createApiError.notFound("User not found.");
  }
  return id;
}

/** 16-character, uppercase hex code (~64 bits of entropy). */
function generateResetCode(): string {
  return randomBytes(8).toString("hex").toUpperCase();
}

/**
 * POST /api/v1/admin/users/[id]/reset-password
 * Generates a one-time password-reset code for a user (e.g. a resident who
 * forgot their password). The code is returned to the caller exactly once;
 * the user redeems it at /reset-password. Existing sessions stay valid until
 * the code is redeemed (redemption bumps the token version). This route does
 * not change the user's password itself.
 */
export const POST = withErrorBoundary<[Request, RouteContext]>(
  async (req, ctx) => {
    assertSameOrigin(req);
    const actor = await requireApiRole(["ADMIN"]);
    const userId = parseId((await ctx.params).id);
    const meta = requestMeta(req);

    const target = await db.user.findUnique({ where: { id: userId } });
    if (!target) throw createApiError.notFound("User not found.");

    const code = generateResetCode();
    const codeHash = await hashPassword(code);
    const expiresAt = new Date(Date.now() + CODE_EXPIRY_MINUTES * 60 * 1000);

    await db.passwordResetCode.upsert({
      where: { userId },
      update: { codeHash, expiresAt, usedAt: null },
      create: { userId, codeHash, expiresAt },
    });

    await recordAudit({
      action: "PASSWORD_RESET_REQUESTED",
      resourceType: "user",
      resourceId: String(userId),
      description: `Admin issued a password-reset code for ${target.email}.`,
      userId: actor.id,
      ...meta,
    });

    return ok({ code, expiresInMinutes: CODE_EXPIRY_MINUTES });
  }
);