import {
  assertSameOrigin,
  createApiError,
  ok,
  withErrorBoundary,
} from "@/lib/api";
import { requireApiPermission } from "@/lib/auth/session";
import { recordAudit, requestMeta } from "@/lib/audit";
import {
  CONSENT_PURPOSES_DEFINITIONS,
  PRIVACY_POLICY_VERSION,
  isConsentPurpose,
  type ConsentPurpose,
} from "@/lib/privacy/catalog";
import { currentConsents, grantConsent, withdrawConsent } from "@/lib/privacy/consent";

export const runtime = "nodejs";

/**
 * GET /api/v1/privacy/consents
 * The signed-in user's consent history (latest state per purpose) plus the
 * catalogue, so the privacy page can render what is granted and what is not.
 */
export const GET = withErrorBoundary(async () => {
  const user = await requireApiPermission("privacy.consent.manage");
  const consents = await currentConsents(user.id);

  return ok({
    policyVersion: PRIVACY_POLICY_VERSION,
    consents: consents.map((consent) => ({
      ...consent,
      grantedAt: consent.grantedAt.toISOString(),
      withdrawnAt: consent.withdrawnAt?.toISOString() ?? null,
    })),
    catalog: CONSENT_PURPOSES_DEFINITIONS,
  });
});

/**
 * POST /api/v1/privacy/consents
 * Grants a consent purpose. Append-only: the previous decision stays in the
 * history.
 */
export const POST = withErrorBoundary(async (req: Request) => {
  assertSameOrigin(req);
  const user = await requireApiPermission("privacy.consent.manage");

  const body = await readPurposeBody(req);
  const meta = requestMeta(req);
  const consent = await grantConsent({
    userId: user.id,
    purpose: body,
    meta: { method: "WEB", ip: meta.ip, userAgent: meta.userAgent },
  });

  await recordAudit({
    action: "CONSENT_GRANTED",
    resourceType: "consent",
    resourceId: body,
    description: `Granted consent ${body}.`,
    userId: user.id,
    ...meta,
  });

  return ok({ consent }, { status: 201 });
});

/**
 * DELETE /api/v1/privacy/consents?purpose=
 * Withdraws a consent. Purposes that are required to hold an account at all
 * cannot be withdrawn here — that is a data-subject erasure request, which the
 * resident files at /privacy/requests.
 */
export const DELETE = withErrorBoundary(async (req: Request) => {
  assertSameOrigin(req);
  const user = await requireApiPermission("privacy.consent.manage");

  const { searchParams } = new URL(req.url);
  const raw = searchParams.get("purpose") ?? "";
  if (!isConsentPurpose(raw)) {
    throw createApiError.badRequest("A valid consent purpose is required.");
  }

  const definition = CONSENT_PURPOSES_DEFINITIONS.find(
    (item) => item.purpose === raw
  );
  if (definition && !definition.withdrawable) {
    throw createApiError.conflict(
      `${definition.label} cannot be withdrawn while the account is open. File a data erasure request if you no longer want your data processed.`
    );
  }

  const meta = requestMeta(req);
  const consent = await withdrawConsent({ userId: user.id, purpose: raw });
  if (!consent) {
    throw createApiError.notFound("There is no active consent for that purpose.");
  }

  await recordAudit({
    action: "CONSENT_WITHDRAWN",
    resourceType: "consent",
    resourceId: raw,
    description: `Withdrew consent ${raw}.`,
    userId: user.id,
    ...meta,
  });

  return ok({ consent });
});

async function readPurposeBody(req: Request): Promise<ConsentPurpose> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw createApiError.badRequest("Request body must be valid JSON.");
  }
  const purpose =
    typeof json === "object" && json !== null && "purpose" in json
      ? (json as { purpose?: unknown }).purpose
      : null;
  if (!isConsentPurpose(purpose)) {
    throw createApiError.badRequest("A valid consent purpose is required.");
  }
  return purpose;
}
