import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import {
  assertSameOrigin,
  createApiError,
  ok,
  parseBody,
  withErrorBoundary,
} from "@/lib/api";
import { requireApiRole } from "@/lib/auth/session";
import { recordAudit, requestMeta } from "@/lib/audit";
import { statusChangeSchema } from "@/lib/validations/case";
import { resolveResolutionDate } from "@/lib/cases/resolution-date";
import { changeConcernStatus } from "@/lib/cases/service";
import { readCappedFormData, saveConcernImage, imageUrlForFile } from "@/lib/uploads";
import { sendConcernProgressEmail } from "@/lib/email";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

function isUniqueConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

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
    const isMultipart = contentType.includes("multipart/form-data");

    let payload: unknown;
    let attachmentFilename: string | null = null;

    if (isMultipart) {
      const form = await readCappedFormData(req);
      const resolutionRaw = form.get("resolution");
      if (typeof resolutionRaw === "string" && resolutionRaw.trim() !== "") {
        try {
          payload = {
            status: form.get("status"),
            remarks: form.get("remarks"),
            resolution: JSON.parse(resolutionRaw),
          };
        } catch {
          throw createApiError.badRequest("Resolution details are not valid JSON.");
        }
      } else {
        payload = { status: form.get("status"), remarks: form.get("remarks") };
      }

      const attachment = form.get("attachment");
      if (attachment instanceof File && attachment.size > 0) {
        attachmentFilename = await saveConcernImage(attachment, user.id);
      }
    } else {
      payload = await parseBody(req, statusChangeSchema);
    }

    const body = statusChangeSchema.parse(payload);
    const attachmentUrl = attachmentFilename ? imageUrlForFile(attachmentFilename) : null;

    const resolveOnDate = body.resolution?.resolvedOn
      ? resolveResolutionDate(body.resolution.resolvedOn)
      : undefined;

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
          resolution: body.resolution
            ? {
                summary: body.resolution.summary,
                actionsTaken: body.resolution.actionsTaken,
                resolutionType: body.resolution.resolutionType,
                resolvedOn: resolveOnDate,
                attachmentUrl,
              }
            : undefined,
        })
      );
    } catch (error) {
      if (isUniqueConflict(error)) {
        throw createApiError.conflict(
          "A resolution is already recorded for this case."
        );
      }
      if (attachmentFilename) {
        const { deleteConcernImage } = await import("@/lib/uploads");
        await deleteConcernImage(attachmentFilename);
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
      description: `${outcome.caseNumber}: status ${outcome.fromStatus} → ${outcome.status}. ${body.remarks}`,
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
      redirect: `/official/concerns/${concernId}`,
    });
  }
);
