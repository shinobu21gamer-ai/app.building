import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createApiError, withErrorBoundary } from "@/lib/api";
import { requireApiUser } from "@/lib/auth/session";
import { logPiiAccess } from "@/lib/privacy/service";
import {
  imageMimeForFilename,
  isSafeImageFilename,
  readConcernImage,
} from "@/lib/uploads";

export const runtime = "nodejs";

type UploadContext = { params: Promise<{ filename: string }> };

/**
 * Proof photos are attached to a case in two places: the resolution record and
 * the status-change journal entry. Both resolve to the owning concern, so one
 * authorization rule covers every kind of case image.
 */
async function proofOwner(imageUrl: string) {
  const resolution = await db.resolutionRecord.findFirst({
    where: { attachmentUrl: imageUrl },
    select: {
      concern: { select: { userId: true, assignedOfficeId: true } },
    },
  });
  if (resolution) return resolution.concern;

  const journalEntry = await db.caseStatusHistory.findFirst({
    where: { attachmentUrl: imageUrl },
    select: {
      concern: { select: { userId: true, assignedOfficeId: true } },
    },
  });
  return journalEntry?.concern ?? null;
}

/**
 * Identity documents are not attached to a concern, so they resolve through
 * the verification row instead. Only the resident and an administrator may
 * open one — the office rule that applies to case photos must never reach an
 * ID document — and an administrator's view is recorded in PiiAccessLog.
 */
async function identityDocumentOwner(imageUrl: string) {
  const row = await db.identityVerification.findFirst({
    where: { OR: [{ idImageUrl: imageUrl }, { selfieUrl: imageUrl }] },
    select: { userId: true },
  });
  return row ? { userId: row.userId, assignedOfficeId: null, identity: true } : null;
}

export const GET = withErrorBoundary<[Request, UploadContext]>(
  async (_req, ctx) => {
    const user = await requireApiUser();
    const { filename } = await ctx.params;

    if (!isSafeImageFilename(filename)) {
      throw createApiError.notFound("Image not found.");
    }

    const imageUrl = `/api/v1/uploads/${filename}`;

    const concern = await db.concern.findFirst({
      where: { imageUrl },
      select: { userId: true, assignedOfficeId: true },
    });

    const owner =
      concern ??
      (await proofOwner(imageUrl)) ??
      (await identityDocumentOwner(imageUrl));
    if (!owner) {
      throw createApiError.notFound("Image not found.");
    }

    const isIdentityDocument = "identity" in owner && owner.identity === true;
    const isOwner = owner.userId === user.id;
    const isAdmin = user.role.key === "ADMIN";
    const isAssignedOfficial =
      !isIdentityDocument &&
      user.role.key === "OFFICIAL" &&
      owner.assignedOfficeId !== null &&
      owner.assignedOfficeId === user.officeId;

    if (!isOwner && !isAdmin && !isAssignedOfficial) {
      throw createApiError.forbidden("You cannot access this image.");
    }

    if (isIdentityDocument && !isOwner && isAdmin) {
      // Reviewing somebody else's ID is an access to personal data: it is
      // logged with the reviewer's id so the resident can ask who looked.
      await logPiiAccess({
        actorId: user.id,
        subjectUserId: owner.userId,
        field: "identity_document",
        purpose: "Reviewing a submitted identity document for verification.",
        resourceType: "identity_verification",
        resourceId: String(owner.userId),
      });
    }

    const mime = imageMimeForFilename(filename);
    const buffer = await readConcernImage(filename);
    if (!mime || !buffer) {
      throw createApiError.notFound("Image not found.");
    }

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": mime,
        "Content-Length": String(buffer.byteLength),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `inline; filename="${filename}"`,
      },
    });
  }
);
