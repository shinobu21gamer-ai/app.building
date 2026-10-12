import { db } from "@/lib/db";
import {
  assertSameOrigin,
  createApiError,
  ok,
  withErrorBoundary,
} from "@/lib/api";
import { requireApiPermission } from "@/lib/auth/session";
import { recordAudit, requestMeta } from "@/lib/audit";
import {
  deleteConcernImage,
  imageUrlForFile,
  readCappedFormData,
  saveConcernImage,
} from "@/lib/uploads";
import { identityGateDecision } from "@/lib/identity/policy";
import {
  identityGateFor,
  identityView,
  isIdentityGateEnabled,
  submitIdentity,
} from "@/lib/identity/verification";
import { identitySubmitSchema } from "@/lib/validations/privacy";

export const runtime = "nodejs";

/**
 * GET /api/v1/identity
 * The signed-in user's own verification state, plus the gate decision that
 * applies to benefit-bearing submissions, so the resident UI can explain what
 * is blocking and what to do next.
 */
export const GET = withErrorBoundary(async () => {
  const user = await requireApiPermission("privacy.identity.submit");
  const [row, gateEnabled] = await Promise.all([
    db.identityVerification.findUnique({ where: { userId: user.id } }),
    isIdentityGateEnabled(),
  ]);
  const identity = identityView(row);

  return ok({
    identity,
    gate: {
      enabled: gateEnabled,
      decision: identityGateDecision({
        concernTypeKey: "AYUDA",
        status: identity.status,
        gateEnabled,
      }),
    },
  });
});

/**
 * POST /api/v1/identity
 * Submits (or re-submits) an identity document for verification.
 * Multipart form: method, idTypeLabel?, idNumber, confirmAccuracy,
 * consentIdVerification, and an `idImage` file.
 */
export const POST = withErrorBoundary(async (req: Request) => {
  assertSameOrigin(req);
  const user = await requireApiPermission("privacy.identity.submit");

  const form = await readCappedFormData(req);
  const parsed = identitySubmitSchema.safeParse({
    method: form.get("method"),
    idTypeLabel: form.get("idTypeLabel") ?? undefined,
    idNumber: form.get("idNumber"),
    confirmAccuracy: form.get("confirmAccuracy"),
    consentIdVerification: form.get("consentIdVerification"),
  });
  if (!parsed.success) throw parsed.error;

  const imageEntry = form.get("idImage");
  if (!(imageEntry instanceof File) || imageEntry.size === 0) {
    throw createApiError.badRequest(
      "Attach a photo of the identity document (JPEG, PNG or WebP, up to 5 MB)."
    );
  }

  const meta = requestMeta(req);
  const filename = await saveConcernImage(imageEntry, user.id);

  let saved;
  try {
    saved = await submitIdentity(user.id, {
      ...parsed.data,
      idImageUrl: imageUrlForFile(filename),
      selfieUrl: null,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  } catch (error) {
    // Never keep an uploaded document that was not recorded.
    await deleteConcernImage(filename);
    throw error;
  }

  await recordAudit({
    action: "IDENTITY_SUBMITTED",
    resourceType: "identity_verification",
    resourceId: String(user.id),
    description: `Submitted a ${parsed.data.method} identity document for verification.`,
    userId: user.id,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  return ok(
    {
      identity: identityView(saved),
      gate: await identityGateFor(user.id, "AYUDA"),
    },
    { status: 201 }
  );
});
