import { NextResponse } from "next/server";

import {
  assertSameOrigin,
  createApiError,
  ok,
  withErrorBoundary,
} from "@/lib/api";
import { getAuthUser, userCan } from "@/lib/auth/session";
import { recordAudit, requestMeta } from "@/lib/audit";
import { getLocale } from "@/lib/locale";
import type { Locale } from "@/lib/i18n";
import { isReportKey } from "@/lib/reports/catalog";
import { csvStreamHeaders, streamDocumentCsv } from "@/lib/reports/stream";
import { loadEngineeringReport } from "@/lib/reports/engineering";
import { resolveReportPeriod } from "@/lib/reports/period";
import { loadPrivacyReport } from "@/lib/reports/privacy";
import { loadTransparencyReport } from "@/lib/reports/transparency";
import { loadTreasuryReport } from "@/lib/reports/treasury";
import type { Actor } from "@/lib/treasury/budget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function localeFrom(value: string | null): Locale {
  return value === "fil" ? "fil" : "en";
}

/**
 * GET /api/v1/reports/{report}?period=90d&from=&to=&format=json|csv
 *
 * One endpoint for the four reports, because they share a period vocabulary, a
 * document shape and an export format. Authorisation differs per report and is
 * resolved in one place below, so a new report cannot accidentally ship
 * unscoped:
 *
 *   engineering  — `report.view.all` sees the barangay, `report.view.office`
 *                  sees only its own office's cases
 *   treasury     — `report.view.treasury` (the query helpers apply the office
 *                  scope for anyone who does not see the whole budget)
 *   privacy      — `privacy.pii_access.view`; counts only, never values
 *   transparency — public: it summarises rows the public page already shows
 */
export const GET = withErrorBoundary<
  [Request, { params: Promise<{ report: string }> }]
>(async (req, ctx) => {
  const { report } = await ctx.params;
  if (!isReportKey(report)) {
    throw createApiError.notFound("Unknown report.");
  }

  const url = new URL(req.url);
  const period = resolveReportPeriod({
    period: url.searchParams.get("period"),
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
  });
  const format = url.searchParams.get("format") === "csv" ? "csv" : "json";
  const locale =
    url.searchParams.get("locale") === null
      ? await getLocale()
      : localeFrom(url.searchParams.get("locale"));

  const user = await getAuthUser();

  // Every report except the public one needs a session and a permission.
  let officeId: number | null = null;
  let actor: Actor | null = null;

  if (report !== "transparency") {
    if (!user) throw createApiError.unauthorized();
    if (report === "engineering") {
      if (await userCan(user.role.key, "report.view.all")) {
        officeId = null;
      } else if (await userCan(user.role.key, "report.view.office")) {
        officeId = user.officeId;
      } else {
        throw createApiError.forbidden();
      }
    }
    if (report === "treasury") {
      const canSee =
        (await userCan(user.role.key, "report.view.treasury")) ||
        (await userCan(user.role.key, "report.view.all"));
      if (!canSee) throw createApiError.forbidden();
      actor = { id: user.id, roleKey: user.role.key, officeId: user.officeId };
    }
    if (report === "privacy") {
      if (!(await userCan(user.role.key, "privacy.pii_access.view"))) {
        throw createApiError.forbidden();
      }
    }
  }

  const document =
    report === "engineering"
      ? await loadEngineeringReport({ locale, period, officeId })
      : report === "treasury"
        ? await loadTreasuryReport({ locale, period, actor: actor! })
        : report === "privacy"
          ? await loadPrivacyReport({ locale, period })
          : await loadTransparencyReport({ locale, period });

  if (format === "csv") {
    // Exports leave the building, so a copy is recorded in the tamper-evident
    // journal: who pulled which report, for which period.
    if (report !== "transparency" && user) {
      assertSameOrigin(req);
      await recordAudit({
        action: "REPORT_EXPORTED",
        resourceType: "report",
        resourceId: report,
        description: `${document.title} exported as CSV for ${period.key}.`,
        userId: user.id,
        ...requestMeta(req),
      });
    }

    // Streamed, not stringified: the case register can run to thousands of rows
    // and the response starts flowing on the first chunk.
    return new NextResponse(streamDocumentCsv(document), {
      headers: csvStreamHeaders(`${document.key}-${document.period.key}`),
    });
  }

  return ok(document);
});
