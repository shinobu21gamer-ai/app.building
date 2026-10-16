import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createApiError, withErrorBoundary } from "@/lib/api";
import { requireApiPermission } from "@/lib/auth/session";
import { logPiiAccess } from "@/lib/privacy/service";
import {
  imageMimeForFilename,
  isSafeImageFilename,
  readConcernImage,
} from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** Admin-only, audited image endpoint for the identity review queue. */
export const GET = withErrorBoundary<[Request, RouteContext]>(async (_req, ctx) => {
  const reviewer = await requireApiPermission("privacy.identity.review");
  const { id: rawId } = await ctx.params;
  const userId = Number(rawId);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw createApiError.notFound("Identity submission not found.");
  }

  const row = await db.identityVerification.findUnique({
    where: { userId },
    select: { idImageUrl: true },
  });
  if (!row?.idImageUrl) {
    throw createApiError.notFound("Identity image not found.");
  }

  const marker = "/api/v1/uploads/";
  const markerIndex = row.idImageUrl.indexOf(marker);
  const filename = markerIndex >= 0
    ? row.idImageUrl.slice(markerIndex + marker.length).split(/[?#]/, 1)[0]
    : "";
  if (!isSafeImageFilename(filename)) {
    throw createApiError.notFound("Identity image not found.");
  }

  const image = await readConcernImage(filename);
  if (!image) throw createApiError.notFound("Identity image not found.");

  await logPiiAccess({
    actorId: reviewer.id,
    subjectUserId: userId,
    field: "identity_document",
    purpose: "Reviewing a submitted identity document for verification.",
    resourceType: "identity_verification",
    resourceId: String(userId),
  });

  return new NextResponse(new Uint8Array(image), {
    headers: {
      "Content-Type": imageMimeForFilename(filename) ?? "application/octet-stream",
      "Content-Length": String(image.byteLength),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `inline; filename="${filename}"`,
    },
  });
});
