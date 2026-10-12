import { db } from "@/lib/db";
import {
  assertSameOrigin,
  createApiError,
  ok,
  withErrorBoundary,
} from "@/lib/api";
import { requireApiPermission } from "@/lib/auth/session";
import { recordAudit, requestMeta } from "@/lib/audit";
import { submitFieldCheck } from "@/lib/cases/field-check";
import { submitFieldCheckSchema } from "@/lib/validations/field-check";
import {
  deleteConcernImage,
  imageUrlForFile,
  readCappedFormData,
  saveConcernImage,
} from "@/lib/uploads";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ checkId: string }> };

/** The file when it is a non-empty part of the form, otherwise null. */
function attachedFile(value: FormDataEntryValue | null): File | null {
  return value instanceof File && value.size > 0 ? value : null;
}

/**
 * The assigned person records the finding. The photo is optional for a
 * confirmed finding and required for a not-confirmed one (checked in the service).
 */
export const POST = withErrorBoundary(
  async (req: Request, context: RouteContext) => {
    assertSameOrigin(req);
    const user = await requireApiPermission("case.fieldcheck.perform");
    const { checkId } = await context.params;
    const id = Number(checkId);
    if (!Number.isInteger(id) || id <= 0)
      throw createApiError.badRequest("Invalid field check id.");

    const form = await readCappedFormData(req);
    const parsed = submitFieldCheckSchema.safeParse({
      finding: form.get("finding") ?? "",
      notes: form.get("notes") ?? null,
    });
    if (!parsed.success) {
      throw createApiError.badRequest(
        parsed.error.issues[0]?.message ?? "Check the finding.",
      );
    }

    const photo = attachedFile(form.get("photo"));
    let photoFilename: string | null = null;
    if (photo) photoFilename = await saveConcernImage(photo, user.id);
    const photoUrl = photoFilename ? imageUrlForFile(photoFilename) : null;

    try {
      const outcome = await db.$transaction((tx) =>
        submitFieldCheck(tx, {
          checkId: id,
          finding: parsed.data.finding,
          notes: parsed.data.notes ?? null,
          photoUrl,
          actor: {
            id: user.id,
            roleKey: user.role.key,
            officeId: user.officeId ?? null,
          },
        }),
      );
      await recordAudit({
        action: "FIELD_CHECK_SUBMITTED",
        resourceType: "field_check",
        resourceId: String(id),
        description: `Recorded field check finding ${parsed.data.finding}.`,
        userId: user.id,
        ...requestMeta(req),
      });
      return ok({ checkId: outcome.checkId, status: "SUBMITTED" });
    } catch (error) {
      if (photoFilename) await deleteConcernImage(photoFilename);
      throw error;
    }
  },
);
