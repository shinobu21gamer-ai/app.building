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
import { resolutionSchema } from "@/lib/validations/case";
import { resolveResolutionDate } from "@/lib/cases/resolution-date";
import { changeConcernStatus } from "@/lib/cases/service";
import {
  deleteConcernImage,
  imageUrlForFile,
  readCappedFormData,
  saveConcernImage,
} from "@/lib/uploads";
import { sendConcernProgressEmail } from "@/lib/email";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const remarksText = (value: unknown): string => {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length < 5 || text.length > 1000) {
    throw createApiError.badRequest(
      "Provide remarks for the resolution (at least 5 characters)."
    );
  }
  return text;
};

/**
 * POST /api/v1/concerns/[id]/resolutions
 * Records a resolution (multipart: summary, actionsTaken, resolutionType,
 * optional resolvedOn date and optional supporting image) and advances the
 * case to RESOLVED in one transaction. Status update, journal history,
 * resident notification, and resident visibility are all handled by the
 * workflow service.
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

    const form = await readCappedFormData(req);

    const remarks = remarksText(form.get("remarks"));

    const raw: Record<string, unknown> = {
      summary: form.get("summary"),
      actionsTaken: form.get("actionsTaken"),
      resolutionType: form.get("resolutionType"),
    };
    const resolvedOn = form.get("resolvedOn");
    if (typeof resolvedOn === "string" && resolvedOn.trim() !== "") {
      raw.resolvedOn = resolvedOn.trim();
    }

    const parsed = resolutionSchema.safeParse(raw);
    if (!parsed.success) throw parsed.error;
    const input = parsed.data;

    const attachment = form.get("attachment");
    let attachmentFilename: string | null = null;
    if (attachment instanceof File && attachment.size > 0) {
      attachmentFilename = await saveConcernImage(attachment, user.id);
    }
    const attachmentUrl = attachmentFilename
      ? imageUrlForFile(attachmentFilename)
      : null;

    const resolveOnDate = input.resolvedOn
      ? resolveResolutionDate(input.resolvedOn)
      : undefined;

    try {
      const outcome = await db.$transaction((tx) =>
        changeConcernStatus(tx, {
          concernId,
          actor: {
            id: user.id,
            roleKey: user.role.key,
            officeId: user.officeId ?? null,
          },
          status: "RESOLVED",
          remarks,
          resolution: {
            summary: input.summary,
            actionsTaken: input.actionsTaken,
            resolutionType: input.resolutionType,
            resolvedOn: resolveOnDate,
            attachmentUrl,
          },
        })
      );

      const meta = requestMeta(req);
      await recordAudit({
        action: "CONCERN_RESOLVED",
        resourceType: "concern",
        resourceId: String(concernId),
        description: `${outcome.caseNumber}: marked resolved on ${
          (resolveOnDate ?? new Date()).toISOString().slice(0, 10)
        }. ${remarks}`,
        userId: user.id,
        ...meta,
      });

      void sendConcernProgressEmail({
        concernId: outcome.concernId,
        caseNumber: outcome.caseNumber,
        status: outcome.status,
        remarks,
      });

      return ok({
        concernId: outcome.concernId,
        caseNumber: outcome.caseNumber,
        status: outcome.status,
        resolution: {
          summary: input.summary,
          actionsTaken: input.actionsTaken,
          resolutionType: input.resolutionType,
          resolvedOn: resolveOnDate ?? new Date(),
          attachmentUrl,
        },
        redirect: `/official/concerns/${concernId}`,
      });
    } catch (error) {
      if (attachmentFilename) await deleteConcernImage(attachmentFilename);
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw createApiError.conflict(
          "A resolution is already recorded for this case."
        );
      }
      throw error;
    }
  }
);