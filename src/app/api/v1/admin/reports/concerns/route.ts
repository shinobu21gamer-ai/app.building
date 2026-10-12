import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { assertSameOrigin, withErrorBoundary } from "@/lib/api";
import { requireApiRole } from "@/lib/auth/session";
import { parseConcernFilters, buildConcernWhere } from "@/lib/cases/query";
import { csvFilename, toCsv, type CsvValue } from "@/lib/reports/csv";

export const runtime = "nodejs";

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

  // Quoting, formula-guarding and the filename come from the shared CSV writer
  // (`src/lib/reports/csv.ts`), so this export cannot drift from the report
  // exports — resident-supplied titles and names reach these cells.
  const header = [
    "Case number",
    "Title",
    "Category",
    "Resident",
    "Resident email",
    "Status",
    "Priority",
    "Office",
    "Submitted",
    "SLA due",
    "SLA status",
    "Duplicate of",
  ];
  const now = Date.now();
  const rows: CsvValue[][] = concerns.map((concern) => {
    const active = concern.status !== "RESOLVED" && concern.status !== "CLOSED";
    const overdue = active && concern.slaDueAt !== null && concern.slaDueAt.getTime() < now;
    return [
      concern.caseNumber,
      concern.title,
      concern.category.name,
      `${concern.user.firstName} ${concern.user.lastName}`,
      concern.user.email,
      concern.status,
      concern.priorityLevel,
      concern.assignedOffice?.name,
      concern.createdAt,
      concern.slaDueAt,
      active ? (overdue ? "OVERDUE" : "OPEN") : "COMPLETE",
      concern.duplicateOfId,
    ];
  });

  return new NextResponse(toCsv(header, rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${csvFilename("concerns")}"`,
      "Cache-Control": "no-store",
    },
  });
});
