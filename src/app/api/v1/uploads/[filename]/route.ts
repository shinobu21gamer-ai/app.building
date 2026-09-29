import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createApiError, withErrorBoundary } from "@/lib/api";
import { requireApiUser } from "@/lib/auth/session";
import {
  imageMimeForFilename,
  isSafeImageFilename,
  readConcernImage,
} from "@/lib/uploads";

export const runtime = "nodejs";

type UploadContext = { params: Promise<{ filename: string }> };

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

    // Resolution attachments live on ResolutionRecord.attachmentUrl; resolve
    // to the same ownership shape so one authorization rule covers both.
    const attachmentOwner = concern
      ? null
      : await db.resolutionRecord
          .findFirst({
            where: { attachmentUrl: imageUrl },
            select: {
              concern: {
                select: { userId: true, assignedOfficeId: true },
              },
            },
          })
          .then((record) => record?.concern ?? null);

    const owner = concern ?? attachmentOwner;
    if (!owner) {
      throw createApiError.notFound("Image not found.");
    }

    const isOwner = owner.userId === user.id;
    const isAdmin = user.role.key === "ADMIN";
    const isAssignedOfficial =
      user.role.key === "OFFICIAL" &&
      owner.assignedOfficeId !== null &&
      owner.assignedOfficeId === user.officeId;

    if (!isOwner && !isAdmin && !isAssignedOfficial) {
      throw createApiError.forbidden("You cannot access this image.");
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
