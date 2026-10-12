import { db } from "@/lib/db";
import {
  assertSameOrigin,
  createApiError,
  ok,
  parseBody,
  withErrorBoundary,
} from "@/lib/api";
import { requireApiPermission, requireApiUser } from "@/lib/auth/session";
import { recordAudit, requestMeta } from "@/lib/audit";
import { crewRosterUpsertSchema } from "@/lib/validations/crew";
import { listCrewRoster } from "@/lib/cases/crew";

export const runtime = "nodejs";

/**
 * GET /api/v1/admin/crew
 * The crew roster with each person's current open caseload, for the assignment
 * picker and the roster desk.
 */
export const GET = withErrorBoundary(async (req: Request) => {
  const user = await requireApiPermission("case.crew.assign");
  const { searchParams } = new URL(req.url);
  const availability = searchParams.get("availability");
  const officeId = searchParams.get("officeId");

  const roster = await listCrewRoster(db, {
    officeId:
      user.role.key === "ADMIN"
        ? officeId
          ? Number(officeId)
          : null
        : (user.officeId ?? null),
  });

  const filtered = availability
    ? roster.filter((member) => member.availability === availability)
    : roster;

  return ok({ crew: filtered, total: filtered.length });
});

/**
 * POST /api/v1/admin/crew
 * Creates or updates the roster entry for a crew user (trade, rates,
 * availability, how many cases they may hold at once).
 */
export const POST = withErrorBoundary(async (req: Request) => {
  assertSameOrigin(req);
  const user = await requireApiUser();
  if (!(await requireApiPermission("crew.roster.manage"))) {
    throw createApiError.forbidden();
  }

  const body = await parseBody(req, crewRosterUpsertSchema);

  const target = await db.user.findUnique({
    where: { id: body.userId },
    select: { id: true, role: { select: { key: true } } },
  });
  if (!target) throw createApiError.notFound("User not found.");
  if (target.role.key !== "CREW") {
    throw createApiError.badRequest(
      "Only users with the CREW role can have a crew profile."
    );
  }

  const profile = await db.crewProfile.upsert({
    where: { userId: body.userId },
    update: {
      ...(body.trade === undefined ? {} : { trade: body.trade || null }),
      ...(body.employmentType === undefined
        ? {}
        : { employmentType: body.employmentType || "JOB_ORDER" }),
      ...(body.hourlyRate === undefined ? {} : { hourlyRate: body.hourlyRate }),
      ...(body.dailyRate === undefined ? {} : { dailyRate: body.dailyRate }),
      ...(body.availability === undefined
        ? {}
        : { availability: body.availability }),
      ...(body.maxConcurrentCases === undefined
        ? {}
        : { maxConcurrentCases: body.maxConcurrentCases }),
      ...(body.officeId === undefined ? {} : { officeId: body.officeId }),
      ...(body.notes === undefined ? {} : { notes: body.notes || null }),
      ...(body.isActive === undefined ? {} : { isActive: body.isActive }),
    },
    create: {
      userId: body.userId,
      trade: body.trade || null,
      employmentType: body.employmentType || "JOB_ORDER",
      hourlyRate: body.hourlyRate ?? null,
      dailyRate: body.dailyRate ?? null,
      availability: body.availability ?? "AVAILABLE",
      maxConcurrentCases: body.maxConcurrentCases ?? 1,
      officeId: body.officeId ?? null,
      notes: body.notes || null,
      isActive: body.isActive ?? true,
    },
  });

  const meta = requestMeta(req);
  await recordAudit({
    action: "CREW_PROFILE_UPDATED",
    resourceType: "crew_profile",
    resourceId: String(profile.id),
    description: `Crew profile for user #${body.userId} updated.`,
    userId: user.id,
    ...meta,
  });

  return ok({
    id: profile.id,
    userId: profile.userId,
    trade: profile.trade,
    employmentType: profile.employmentType,
    hourlyRate: profile.hourlyRate?.toString() ?? null,
    dailyRate: profile.dailyRate?.toString() ?? null,
    availability: profile.availability,
    maxConcurrentCases: profile.maxConcurrentCases,
    isActive: profile.isActive,
  });
});
