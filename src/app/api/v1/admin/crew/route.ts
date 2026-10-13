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
import { listCrewDesk, listCrewRoster } from "@/lib/cases/crew";

export const runtime = "nodejs";

/**
 * GET /api/v1/admin/crew
 *
 * Default: the crew roster with each person's current open caseload, for the
 * assignment picker. `?includeOtherOffices=1` also carries profiled crew from
 * other offices (flagged), so a case routed to an office without its own crew
 * is not a dead end.
 *
 * `?scope=desk` (the roster desk) lists every crew account instead — profiled
 * or not, active or disabled — which is what the admin crew screen edits.
 */
export const GET = withErrorBoundary(async (req: Request) => {
  const user = await requireApiPermission("case.crew.assign");
  const { searchParams } = new URL(req.url);
  const availability = searchParams.get("availability");
  const officeId = searchParams.get("officeId");
  const scope = searchParams.get("scope");

  if (scope === "desk") {
    if (!(await requireApiPermission("crew.roster.manage"))) {
      throw createApiError.forbidden();
    }
    const crew = await listCrewDesk(db);
    return ok({ crew, total: crew.length, scope: "desk" as const });
  }

  const roster = await listCrewRoster(db, {
    officeId:
      user.role.key === "ADMIN"
        ? officeId
          ? Number(officeId)
          : null
        : (user.officeId ?? null),
    includeOtherOffices: searchParams.get("includeOtherOffices") === "1",
  });

  const filtered = availability
    ? roster.filter((member) => member.availability === availability)
    : roster;

  return ok({ crew: filtered, total: filtered.length, scope: "roster" as const });
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

  const existing = await db.crewProfile.findUnique({
    where: { userId: body.userId },
    select: { id: true },
  });

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
    description: `Crew profile for user #${body.userId} ${
      existing ? "updated" : "created"
    }.`,
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
    officeId: profile.officeId,
    notes: profile.notes,
    isActive: profile.isActive,
  });
});
