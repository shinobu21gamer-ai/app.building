import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { assertSameOrigin, withErrorBoundary } from "@/lib/api";
import { requireApiRole } from "@/lib/auth/session";
import { parseConcernFilters, buildConcernWhere } from "@/lib/cases/query";

export const runtime = "nodejs";

function csvCell(value: unknown): string {
  let text = value instanceof Date ? value.toISOString() : String(value ?? "");
  // Formula injection: a value beginning with = + - @ (or a tab/line feed)
  // is interpreted as a spreadsheet formula when the export is opened in
  // Excel/Sheets. Neutralize the leading character so the cell renders as text.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

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
  const rows = concerns.map((concern) => {
    const active = concern.status !== "RESOLVED" && concern.status !== "CLOSED";
    const overdue = active && concern.slaDueAt !== null && concern.slaDueAt.getTime() < Date.now();
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
    ].map(csvCell).join(",");
  });

  return new NextResponse([header.map(csvCell).join(","), ...rows].join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="barangayresolve-concerns-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
});
