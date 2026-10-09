import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import {
  assertSameOrigin,
  createApiError,
  ok,
  withErrorBoundary,
} from "@/lib/api";
import { requireApiRole } from "@/lib/auth/session";
import { recordAudit, requestMeta } from "@/lib/audit";
import { statusChangeSchema } from "@/lib/validations/case";
import { changeConcernStatus } from "@/lib/cases/service";
import { PROOF_REQUIRED_MESSAGE } from "@/lib/cases/workflow";
import {
  deleteConcernImage,
  imageUrlForFile,
  readCappedFormData,
  saveConcernImage,
} from "@/lib/uploads";
import { sendConcernProgressEmail } from "@/lib/email";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

function isUniqueConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

/** The uploaded file when it is a non-empty part of the form, otherwise null. */
function attachedFile(value: FormDataEntryValue | null): File | null {
  return value instanceof File && value.size > 0 ? value : null;
}

/**
 * POST /api/v1/concerns/[id]/status
 *
 * Moves a case to IN_PROGRESS, RESOLVED or CLOSED. Every status change must
 * carry a proof photo, so it is accepted only as multipart form data with the
 * image attached. JSON cannot carry a file and is refused.
 *
 * Optional `occurredOn` (YYYY-MM-DD) records the day the change happened; it
 * defaults to today (Asia/Manila). RESOLVED takes its date from `resolution`.
 */
export const POST = withErrorBoundary<[Request, RouteContext]>(
  async (req, ctx) => {
    assertSameOrigin(req);
    const user = await requireApiRole(["OFFICIAL", "ADMIN"]);

    const { id } = await ctx.params;
    const concernId = Number(id);
    if (!Number.isInteger(concernId) || concernId <= 0) {
      throw createApiError.notFound("Concern not found.");
    }

    const contentType = req.headers.get("content-type") || "";
    if (!contentType.includes("multipart/form-data")) {
      throw createApiError.badRequest(
        "Status updates must be sent as multipart form data with a proof photo attached."
      );
    }

    const form = await readCappedFormData(req);

    const resolutionRaw = form.get("resolution");
    let resolution: unknown;
    if (typeof resolutionRaw === "string" && resolutionRaw.trim() !== "") {
      try {
        resolution = JSON.parse(resolutionRaw);
      } catch {
        throw createApiError.badRequest("Resolution details are not valid JSON.");
      }
    }

    // Validate every field before anything is written, so a rejected request
    // cannot leave an orphaned image file behind.
    const body = statusChangeSchema.parse({
      status: form.get("status"),
      remarks: form.get("remarks"),
      occurredOn: form.get("occurredOn") ?? undefined,
      resolution,
    });

    const proof = attachedFile(form.get("attachment"));
    if (!proof) {
      throw createApiError.badRequest(PROOF_REQUIRED_MESSAGE);
    }

    const proofFilename = await saveConcernImage(proof, user.id);
    const proofUrl = imageUrlForFile(proofFilename);

    let outcome;
    try {
      outcome = await db.$transaction((tx) =>
        changeConcernStatus(tx, {
          concernId,
          actor: {
            id: user.id,
            roleKey: user.role.key,
            officeId: user.officeId ?? null,
          },
          status: body.status,
          remarks: body.remarks,
          occurredOn: body.occurredOn,
          proofUrl,
          resolution: body.resolution
            ? {
                summary: body.resolution.summary,
                actionsTaken: body.resolution.actionsTaken,
                resolutionType: body.resolution.resolutionType,
                resolvedOn: body.resolution.resolvedOn,
              }
            : undefined,
        })
      );
    } catch (error) {
      await deleteConcernImage(proofFilename);
      if (isUniqueConflict(error)) {
        throw createApiError.conflict(
          "A resolution is already recorded for this case."
        );
      }
      throw error;
    }

    const action =
      outcome.status === "RESOLVED"
        ? "CONCERN_RESOLVED"
        : outcome.status === "CLOSED"
          ? "CASE_CLOSED"
          : "CONCERN_STATUS_CHANGED";

    const meta = requestMeta(req);
    await recordAudit({
      action,
      resourceType: "concern",
      resourceId: String(concernId),
      description: `${outcome.caseNumber}: status ${outcome.fromStatus} → ${outcome.status}, action date ${outcome.actionDate}, proof photo attached. ${body.remarks}`,
      userId: user.id,
      ...meta,
    });

    void sendConcernProgressEmail({
      concernId: outcome.concernId,
      caseNumber: outcome.caseNumber,
      status: outcome.status,
      remarks: body.remarks,
    });

    return ok({
      concernId: outcome.concernId,
      caseNumber: outcome.caseNumber,
      fromStatus: outcome.fromStatus,
      status: outcome.status,
      actionDate: outcome.actionDate,
      proofUrl,
      redirect: `/official/concerns/${concernId}`,
    });
  }
);
