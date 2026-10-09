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

const remarksText = (value: unknown): string => {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length < 5 || text.length > 1000) {
    throw createApiError.badRequest(
      "Provide remarks for the resolution (at least 5 characters)."
    );
  }
  return text;
};

/** The uploaded file when it is a non-empty part of the form, otherwise null. */
function attachedFile(value: FormDataEntryValue | null): File | null {
  return value instanceof File && value.size > 0 ? value : null;
}

/**
 * POST /api/v1/concerns/[id]/resolutions
 *
 * Records a resolution (multipart: summary, actionsTaken, resolutionType,
 * remarks, a required proof photo and an optional resolvedOn date) and advances
 * the case to RESOLVED in one transaction. The workflow service writes the
 * status update, journal entry, resident notification and resident visibility.
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

    const parsed = resolutionSchema.safeParse({
      summary: form.get("summary"),
      actionsTaken: form.get("actionsTaken"),
      resolutionType: form.get("resolutionType"),
      resolvedOn: form.get("resolvedOn") ?? undefined,
    });
    if (!parsed.success) throw parsed.error;
    const input = parsed.data;

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
          status: "RESOLVED",
          remarks,
          proofUrl,
          resolution: {
            summary: input.summary,
            actionsTaken: input.actionsTaken,
            resolutionType: input.resolutionType,
            resolvedOn: input.resolvedOn,
          },
        })
      );
    } catch (error) {
      await deleteConcernImage(proofFilename);
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

    const meta = requestMeta(req);
    await recordAudit({
      action: "CONCERN_RESOLVED",
      resourceType: "concern",
      resourceId: String(concernId),
      description: `${outcome.caseNumber}: marked resolved on ${outcome.actionDate}, proof photo attached. ${remarks}`,
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
        resolvedOn: outcome.actionDate,
        attachmentUrl: proofUrl,
      },
      redirect: `/official/concerns/${concernId}`,
    });
  }
);
