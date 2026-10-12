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
import { fiscalYearCloseSchema } from "@/lib/validations/treasury";
import { closeFiscalYear } from "@/lib/treasury/budget";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * PATCH /api/v1/admin/treasury/fiscal-years/[id]
 * Closes the year. Refused while any approved allocation is still open, so a
 * closed year can never hide a running appropriation.
 */
export const PATCH = withErrorBoundary<[Request, RouteContext]>(
  async (req, ctx) => {
    assertSameOrigin(req);
    const user = await requireApiRole(["ADMIN"]);
    const { id } = await ctx.params;
    const fiscalYearId = Number(id);
    if (!Number.isInteger(fiscalYearId) || fiscalYearId <= 0) {
      throw createApiError.notFound("Fiscal year not found.");
    }
    const body = await parseBody(req, fiscalYearCloseSchema);

    const outcome = await db.$transaction((tx) =>
      closeFiscalYear(tx, {
        actor: {
          id: user.id,
          roleKey: user.role.key,
          officeId: user.officeId ?? null,
        },
        fiscalYearId,
        notes: body.notes ?? null,
      })
    );

    const meta = requestMeta(req);
    await recordAudit({
      action: "TREASURY_FISCAL_YEAR_CLOSED",
      resourceType: "fiscal_year",
      resourceId: String(fiscalYearId),
      description: `Fiscal year ${outcome.year} closed.${body.notes ? ` ${body.notes}` : ""}`,
      userId: user.id,
      ...meta,
    });

    return ok(outcome);
  }
);
