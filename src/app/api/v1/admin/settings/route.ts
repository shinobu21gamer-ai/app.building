import { db } from "@/lib/db";
import {
  assertSameOrigin,
  createApiError,
  ok,
  parseBody,
  withErrorBoundary,
} from "@/lib/api";
import { requireApiRole } from "@/lib/auth/session";
import { recordAudit, requestMeta } from "@/lib/audit";
import {
  settingDeleteSchema,
  settingUpsertSchema,
} from "@/lib/validations/admin";
import { isFeedbackResubmissionAllowed } from "@/lib/cases/settings";

export const runtime = "nodejs";

/**
 * GET /api/v1/admin/settings
 * Lists administrator-configurable key/value settings, plus a convenience
 * boolean for the resident feedback flag.
 */
export const GET = withErrorBoundary(async () => {
  await requireApiRole(["ADMIN"]);
  const settings = await db.appSetting.findMany({ orderBy: { key: "asc" } });
  return ok({
    settings: settings.map((setting) => ({
      key: setting.key,
      value: setting.value,
      updatedAt: setting.updatedAt,
    })),
    feedbackResubmissionAllowed: await isFeedbackResubmissionAllowed(db),
  });
});

/**
 * POST /api/v1/admin/settings
 * Creates a new setting. Fails with 409 when the key already exists.
 */
export const POST = withErrorBoundary(async (req: Request) => {
  assertSameOrigin(req);
  const user = await requireApiRole(["ADMIN"]);
  const body = await parseBody(req, settingUpsertSchema);

  const existing = await db.appSetting.findUnique({
    where: { key: body.key },
  });
  if (existing) {
    throw createApiError.conflict("A setting with that key already exists.");
  }

  const setting = await db.appSetting.create({
    data: { key: body.key, value: body.value },
  });

  const meta = requestMeta(req);
  await recordAudit({
    action: "SETTING_CREATED",
    resourceType: "setting",
    resourceId: setting.key,
    description: `Created setting ${setting.key}.`,
    userId: user.id,
    ...meta,
  });

  return ok(
    {
      setting: {
        key: setting.key,
        value: setting.value,
        updatedAt: setting.updatedAt,
      },
    },
    { status: 201 }
  );
});

/**
 * PUT /api/v1/admin/settings
 * Creates or updates a single setting from a `{ key, value }` body.
 */
export const PUT = withErrorBoundary(async (req: Request) => {
  assertSameOrigin(req);
  const user = await requireApiRole(["ADMIN"]);
  const body = await parseBody(req, settingUpsertSchema);

  const existing = await db.appSetting.findUnique({
    where: { key: body.key },
  });

  const setting = await db.appSetting.upsert({
    where: { key: body.key },
    update: { value: body.value },
    create: { key: body.key, value: body.value },
  });

  const meta = requestMeta(req);
  await recordAudit({
    action: existing ? "SETTING_UPDATED" : "SETTING_CREATED",
    resourceType: "setting",
    resourceId: setting.key,
    description: existing
      ? `Updated setting ${setting.key} to "${setting.value}".`
      : `Created setting ${setting.key}.`,
    userId: user.id,
    ...meta,
  });

  return ok({
    setting: {
      key: setting.key,
      value: setting.value,
      updatedAt: setting.updatedAt,
    },
  });
});

/**
 * DELETE /api/v1/admin/settings?key=
 * Removes a setting; callers fall back to each setting's default.
 */
export const DELETE = withErrorBoundary(async (req: Request) => {
  assertSameOrigin(req);
  const user = await requireApiRole(["ADMIN"]);

  const { searchParams } = new URL(req.url);
  const parsed = settingDeleteSchema.safeParse({
    key: searchParams.get("key") ?? "",
  });
  if (!parsed.success) {
    throw createApiError.badRequest("A valid setting key is required.");
  }

  const existing = await db.appSetting.findUnique({
    where: { key: parsed.data.key },
  });
  if (!existing) throw createApiError.notFound("Setting not found.");

  await db.appSetting.delete({ where: { key: parsed.data.key } });

  const meta = requestMeta(req);
  await recordAudit({
    action: "SETTING_DELETED",
    resourceType: "setting",
    resourceId: existing.key,
    description: `Deleted setting ${existing.key}.`,
    userId: user.id,
    ...meta,
  });

  return ok({ deleted: true });
});
