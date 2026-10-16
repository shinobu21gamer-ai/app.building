import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createApiError, withErrorBoundary } from "@/lib/api";
import { requireApiUser } from "@/lib/auth/session";
import { logPiiAccess } from "@/lib/privacy/service";
import { WIDE_ROLES } from "@/lib/treasury/disbursement";
import {
  imageMimeForFilename,
  isSafeImageFilename,
  readConcernImage,
} from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UploadContext = { params: Promise<{ filename: string }> };

type CaseOwner = {
  userId: number;
  assignedOfficeId: number | null;
  fieldCheckAssigneeId?: number;
  identity?: boolean;
};

/** Stored URLs are usually `/api/v1/uploads/<file>`; some older rows kept a host. */
function storedUrlWhere(field: string, filename: string) {
  const imageUrl = `/api/v1/uploads/${filename}`;
  return {
    OR: [{ [field]: imageUrl }, { [field]: { endsWith: `/${filename}` } }],
  };
}

/**
 * Proof photos are attached to a case through the resolution record and
 * the status-change journal entry, plus field-check findings. All resolve to
 * the owning concern, so one
 * authorization rule covers every kind of case image.
 */
async function proofOwner(filename: string): Promise<CaseOwner | null> {
  const resolution = await db.resolutionRecord.findFirst({
    where: storedUrlWhere("attachmentUrl", filename),
    select: {
      concern: { select: { userId: true, assignedOfficeId: true } },
    },
  });
  if (resolution) return resolution.concern;

  const journalEntry = await db.caseStatusHistory.findFirst({
    where: storedUrlWhere("attachmentUrl", filename),
    select: {
      concern: { select: { userId: true, assignedOfficeId: true } },
    },
  });
  if (journalEntry) return journalEntry.concern;

  const fieldCheck = await db.fieldCheck.findFirst({
    where: storedUrlWhere("findingPhotoUrl", filename),
    select: {
      assigneeId: true,
      concern: { select: { userId: true, assignedOfficeId: true } },
    },
  });
  return fieldCheck
    ? { ...fieldCheck.concern, fieldCheckAssigneeId: fieldCheck.assigneeId }
    : null;
}

/**
 * Identity documents are not attached to a concern, so they resolve through
 * the verification row instead. Only the resident and an administrator may
 * open one — the office rule that applies to case photos must never reach an
 * ID document — and an administrator's view is recorded in PiiAccessLog.
 */
async function identityDocumentOwner(filename: string): Promise<CaseOwner | null> {
  const row = await db.identityVerification.findFirst({
    where: {
      OR: [
        ...storedUrlWhere("idImageUrl", filename).OR,
        ...storedUrlWhere("selfieUrl", filename).OR,
      ],
    },
    select: { userId: true },
  });
  return row ? { userId: row.userId, assignedOfficeId: null, identity: true } : null;
}

/**
 * Receipt photos are attached to a disbursement voucher, not to a concern.
 * Vouchers are a treasury matter — the same wide roles that may open the
 * voucher page are the only ones who may open its receipt.
 */
async function voucherProof(filename: string) {
  const row = await db.disbursement.findFirst({
    where: storedUrlWhere("proofUrl", filename),
    select: { id: true },
  });
  return row ?? null;
}

export const GET = withErrorBoundary<[Request, UploadContext]>(
  async (_req, ctx) => {
    const user = await requireApiUser();
    const { filename: raw } = await ctx.params;
    const filename = decodeURIComponent(raw);

    if (!isSafeImageFilename(filename)) {
      throw createApiError.notFound("Image not found.");
    }

    const concern = await db.concern.findFirst({
      where: storedUrlWhere("imageUrl", filename),
      select: { userId: true, assignedOfficeId: true },
    });

    const owner =
      concern ??
      (await proofOwner(filename)) ??
      (await identityDocumentOwner(filename));
    const receipt = owner ? null : await voucherProof(filename);
    if (!owner && !receipt) {
      throw createApiError.notFound("Image not found.");
    }

    // A voucher receipt never falls under the case rules — it is gated by the
    // treasury roles alone, and the authorization ends here.
    if (receipt) {
      if (!WIDE_ROLES.includes(user.role.key)) {
        throw createApiError.forbidden("You cannot access this image.");
      }
      return sendImage(filename);
    }

    if (!owner) {
      throw createApiError.notFound("Image not found.");
    }

    const isIdentityDocument = owner.identity === true;
    const isOwner = owner.userId === user.id;
    const isAdmin = user.role.key === "ADMIN";
    // Anyone who may open the case sheet may see its proof photo. ID documents
    // stay resident + admin only.
    const isHallStaff =
      !isIdentityDocument && WIDE_ROLES.includes(user.role.key);
    const isFieldCheckAssignee =
      !isIdentityDocument && owner.fieldCheckAssigneeId === user.id;
    const isAssignedOfficial =
      !isIdentityDocument &&
      user.role.key === "OFFICIAL" &&
      owner.assignedOfficeId !== null &&
      owner.assignedOfficeId === user.officeId;

    if (
      !isOwner &&
      !isAdmin &&
      !isHallStaff &&
      !isAssignedOfficial &&
      !isFieldCheckAssignee
    ) {
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

    return sendImage(filename);
  }
);

async function sendImage(filename: string) {
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
