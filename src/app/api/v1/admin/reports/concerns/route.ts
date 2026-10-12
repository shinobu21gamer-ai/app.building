import { NextResponse } from "next/server";

import { assertSameOrigin, withErrorBoundary } from "@/lib/api";
import { requireApiRole } from "@/lib/auth/session";
import { buildConcernWhere, parseConcernFilters } from "@/lib/cases/query";
import { db } from "@/lib/db";
import { textColumn, type ReportSection } from "@/lib/reports/document";
import { csvStreamHeaders, streamSectionCsv } from "@/lib/reports/stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const concerns = await db.concern.findMany({
    where: buildConcernWhere(filters),
    include: {
      category: { select: { name: true } },
      user: { select: { email: true, firstName: true, lastName: true } },
      assignedOffice: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 5000,
  });

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

  return new NextResponse(streamSectionCsv(section), {
    headers: csvStreamHeaders(
      `concerns-${new Date().toISOString().slice(0, 10)}`
    ),
  });
});
