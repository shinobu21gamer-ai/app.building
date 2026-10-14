import { NextResponse } from "next/server";

import { assertSameOrigin, withErrorBoundary } from "@/lib/api";
import { requireApiRole } from "@/lib/auth/session";
import { buildConcernWhere, parseConcernFilters } from "@/lib/cases/query";
import { db } from "@/lib/db";
import { capRows, textColumn, type ReportSection } from "@/lib/reports/document";
import { csvStreamHeaders, streamSectionCsv } from "@/lib/reports/stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Matches the cap every other report in `src/lib/reports/*` reads past by one
 * row to detect (see `capRows`); this export used to cap silently instead. */
const CONCERN_REGISTER_ROW_LIMIT = 5000;

/**
 * The case register as a CSV a spreadsheet can open.
 *
 * This is the pre-revamp export, so it keeps its own columns and its own
 * filters — but not its own CSV writer. Cells go through the shared,
 * formula-guarded `csv` module and the body streams in 250-row chunks
 * (`src/lib/reports/stream.ts`), so a large register is never built as one
 * string in memory.
 */
export const GET = withErrorBoundary(async (req: Request) => {
  assertSameOrigin(req);
  await requireApiRole(["ADMIN"]);

  const filters = parseConcernFilters(new URL(req.url).searchParams);
  const found = await db.concern.findMany({
    where: buildConcernWhere(filters),
    include: {
      category: { select: { name: true } },
      user: { select: { email: true, firstName: true, lastName: true } },
      assignedOffice: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    // One row past the limit, purely to tell "exactly at the limit" from
    // "more rows match than this export carries" — see capRows below.
    take: CONCERN_REGISTER_ROW_LIMIT + 1,
  });
  const { rows: concerns, truncated } = capRows(found, CONCERN_REGISTER_ROW_LIMIT);

  const now = Date.now();
  const section: ReportSection = {
    key: "concerns",
    title: "Case register",
    columns: [
      textColumn("caseNumber", "Case number"),
      textColumn("title", "Title"),
      textColumn("category", "Category"),
      textColumn("resident", "Resident"),
      textColumn("residentEmail", "Resident email"),
      textColumn("status", "Status"),
      textColumn("priority", "Priority"),
      textColumn("office", "Office"),
      textColumn("submitted", "Submitted"),
      textColumn("slaDue", "SLA due"),
      textColumn("slaStatus", "SLA status"),
      textColumn("duplicateOf", "Duplicate of"),
    ],
    rows: concerns.map((concern) => {
      const active = concern.status !== "RESOLVED" && concern.status !== "CLOSED";
      const overdue =
        active && concern.slaDueAt !== null && concern.slaDueAt.getTime() < now;
      return {
        caseNumber: concern.caseNumber,
        title: concern.title,
        category: concern.category.name,
        resident: `${concern.user.firstName} ${concern.user.lastName}`,
        residentEmail: concern.user.email,
        status: concern.status,
        priority: concern.priorityLevel ?? "",
        office: concern.assignedOffice?.name ?? "",
        submitted: concern.createdAt.toISOString(),
        slaDue: concern.slaDueAt ? concern.slaDueAt.toISOString() : "",
        slaStatus: active ? (overdue ? "OVERDUE" : "OPEN") : "COMPLETE",
        duplicateOf: concern.duplicateOfId === null ? "" : concern.duplicateOfId,
      };
    }),
  };

  if (truncated) {
    // A file that silently stops at the limit looks complete to whoever
    // opens it — it must say so, in the file itself, not only in a response
    // header a spreadsheet application will never show. Newest-first
    // ordering means it is the oldest matching cases that are missing.
    section.rows.push({
      caseNumber: `⚠ TRUNCATED — showing only the newest ${CONCERN_REGISTER_ROW_LIMIT.toLocaleString("en-US")} of this filter's matching cases.`,
      title: "Narrow the date range or filters to see the rest.",
      category: "",
      resident: "",
      residentEmail: "",
      status: "",
      priority: "",
      office: "",
      submitted: "",
      slaDue: "",
      slaStatus: "",
      duplicateOf: "",
    });
  }

  return new NextResponse(streamSectionCsv(section), {
    headers: csvStreamHeaders(
      `concerns-${new Date().toISOString().slice(0, 10)}`
    ),
  });
});
