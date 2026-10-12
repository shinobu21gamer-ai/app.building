import { db } from "@/lib/db";
import {
  assertSameOrigin,
  ok,
  parseBody,
  withErrorBoundary,
} from "@/lib/api";
import { requireApiRole } from "@/lib/auth/session";
import { recordAudit, requestMeta } from "@/lib/audit";
import { fiscalYearCreateSchema } from "@/lib/validations/treasury";
import { createFiscalYear } from "@/lib/treasury/budget";

export const runtime = "nodejs";

/**
 * GET /api/v1/admin/treasury/fiscal-years
 * Fiscal years with how much is appropriated in each. Administrators and the
 * treasurer both need this list to build an allocation.
 */
export const GET = withErrorBoundary<[]>(
  async () => {
    await requireApiRole(["ADMIN", "TREASURER"]);

    const fiscalYears = await db.fiscalYear.findMany({
      orderBy: { year: "desc" },
      include: {
        allocations: {
          select: { id: true, appropriation: true, status: true, officeId: true },
        },
      },
    });

    return ok({
      fiscalYears: fiscalYears.map((year) => ({
        id: year.id,
        year: year.year,
        name: year.name,
        startsOn: year.startsOn,
        endsOn: year.endsOn,
        isClosed: year.isClosed,
        closedAt: year.closedAt,
        allocationCount: year.allocations.length,
        approvedCount: year.allocations.filter(
          (allocation) => allocation.status === "APPROVED"
        ).length,
        appropriated: year.allocations.reduce(
          (sum, allocation) => sum + Number(allocation.appropriation),
          0
        ),
      })),
    });
  }
);

/**
 * POST /api/v1/admin/treasury/fiscal-years
 * Opens a fiscal year. Administrator only: this is the frame every
 * appropriation hangs from.
 */
export const POST = withErrorBoundary<[Request]>(
  async (req) => {
    assertSameOrigin(req);
    const user = await requireApiRole(["ADMIN"]);
    const body = await parseBody(req, fiscalYearCreateSchema);

    const outcome = await db.$transaction((tx) =>
      createFiscalYear(tx, {
        actor: {
          id: user.id,
          roleKey: user.role.key,
          officeId: user.officeId ?? null,
        },
        year: body.year,
        name: body.name ?? null,
        startsOn: body.startsOn,
        endsOn: body.endsOn,
      })
    );

    const meta = requestMeta(req);
    await recordAudit({
      action: "TREASURY_FISCAL_YEAR_CREATED",
      resourceType: "fiscal_year",
      resourceId: String(outcome.fiscalYearId),
      description: `Fiscal year ${outcome.year} opened (${body.startsOn} → ${body.endsOn}).`,
      userId: user.id,
      ...meta,
    });

    return ok(outcome);
  }
);
