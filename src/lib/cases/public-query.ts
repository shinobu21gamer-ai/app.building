// Read side of the public transparency page.
//
// The projection table (`PublicCaseRecord`) is the only thing this module
// reads, and it never joins back to `Concern`: a join would put the case
// number, the resident and the exact coordinates one query away from a public
// page. Everything selected here is already suitable for publication.

import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";

export const PUBLIC_PAGE_SIZE = 20;

export const PUBLIC_STATUSES = [
  "SUBMITTED",
  "ASSIGNED",
  "UNDER_ASSESSMENT",
  "AWAITING_BUDGET",
  "IN_PROGRESS",
  "RESOLVED",
  "CLOSED",
] as const;

export type PublicCaseFilters = {
  typeKey?: string | null;
  status?: string | null;
  area?: string | null;
  page?: number;
};

export type PublicCaseRow = {
  publicRef: string;
  typeKey: string | null;
  categoryName: string | null;
  publicTitle: string | null;
  status: string;
  areaLabel: string | null;
  lat: number | null;
  lng: number | null;
  submittedAt: Date;
  resolvedAt: Date | null;
  closedAt: Date | null;
  responseHours: number | null;
  resolutionType: string | null;
};

/** The columns a public page may see. Exported so tests can assert on it. */
export const PUBLIC_SELECT = {
  publicRef: true,
  typeKey: true,
  categoryName: true,
  publicTitle: true,
  status: true,
  areaLabel: true,
  lat: true,
  lng: true,
  submittedAt: true,
  resolvedAt: true,
  closedAt: true,
  responseHours: true,
  resolutionType: true,
} as const;

/**
 * Filters, as a Prisma `where`. Only a published projection is public, so
 * `published: true` is not optional here.
 */
export function publicWhere(
  filters: PublicCaseFilters
): Prisma.PublicCaseRecordWhereInput {
  const where: Prisma.PublicCaseRecordWhereInput = { published: true };
  const typeKey = filters.typeKey?.trim();
  const status = filters.status?.trim();
  const area = filters.area?.trim();

  if (typeKey) where.typeKey = typeKey;
  if (status && (PUBLIC_STATUSES as readonly string[]).includes(status)) {
    where.status = status;
  }
  if (area) where.areaLabel = area;

  return where;
}

export function publicPageCount(
  total: number,
  pageSize = PUBLIC_PAGE_SIZE
): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

export function clampPage(page: number | undefined, pageCount: number): number {
  const value = Number.isFinite(page) ? Math.trunc(page as number) : 1;
  return Math.min(Math.max(1, value), pageCount);
}

export type PublicStats = {
  published: number;
  resolved: number;
  resolvedShare: number;
  averageResponseHours: number | null;
};

type StatRow = { status: string; responseHours: number | null };

/** Averages over the cases that actually have a recorded response time. */
export function summarizePublicCases(rows: StatRow[]): PublicStats {
  const resolved = rows.filter(
    (row) => row.status === "RESOLVED" || row.status === "CLOSED"
  );
  const measured = resolved.filter(
    (row) => typeof row.responseHours === "number" && row.responseHours >= 0
  );
  const totalHours = measured.reduce(
    (sum, row) => sum + (row.responseHours ?? 0),
    0
  );

  return {
    published: rows.length,
    resolved: resolved.length,
    resolvedShare: rows.length === 0 ? 0 : resolved.length / rows.length,
    averageResponseHours:
      measured.length === 0 ? null : Math.round(totalHours / measured.length),
  };
}

export type PublicFacets = {
  types: { key: string; count: number; label: string }[];
  areas: string[];
};

/** Facets come from their own group-by so they do not shrink to the current page. */
export async function publicFacets(): Promise<PublicFacets> {
  const [byType, byArea, names] = await Promise.all([
    db.publicCaseRecord.groupBy({
      by: ["typeKey"],
      where: { published: true },
      _count: { _all: true },
    }),
    db.publicCaseRecord.groupBy({
      by: ["areaLabel"],
      where: { published: true },
      _count: { _all: true },
      orderBy: { areaLabel: "asc" },
    }),
    db.concernType.findMany({ select: { key: true, name: true } }),
  ]);

  const nameByKey = new Map(names.map((type) => [type.key, type.name]));
  const types = byType
    .filter((row) => Boolean(row.typeKey))
    .map((row) => ({
      key: row.typeKey as string,
      count: row._count._all,
      label: nameByKey.get(row.typeKey as string) ?? (row.typeKey as string),
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  return {
    types,
    areas: byArea
      .map((row) => row.areaLabel)
      .filter((area): area is string => Boolean(area)),
  };
}

export type PublicCaseList = {
  rows: PublicCaseRow[];
  total: number;
  page: number;
  pageCount: number;
  stats: PublicStats;
  facets: PublicFacets;
};

export async function listPublicCases(
  filters: PublicCaseFilters
): Promise<PublicCaseList> {
  const where = publicWhere(filters);

  // Facets and the headline numbers describe the whole collection, so they are
  // read independently of which page of rows is being shown.
  const [total, statRows, facets] = await Promise.all([
    db.publicCaseRecord.count({ where }),
    db.publicCaseRecord.findMany({
      where: { published: true },
      select: { status: true, responseHours: true },
    }),
    publicFacets(),
  ]);

  const pageCount = publicPageCount(total);
  const page = clampPage(filters.page, pageCount);

  const rows: PublicCaseRow[] =
    total === 0
      ? []
      : await db.publicCaseRecord.findMany({
          where,
          select: PUBLIC_SELECT,
          orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
          skip: (page - 1) * PUBLIC_PAGE_SIZE,
          take: PUBLIC_PAGE_SIZE,
        });

  return {
    rows,
    total,
    page,
    pageCount,
    stats: summarizePublicCases(statRows),
    facets,
  };
}

export async function publicCaseDetail(
  publicRef: string
): Promise<PublicCaseRow | null> {
  const row = await db.publicCaseRecord.findFirst({
    where: { publicRef, published: true },
    select: PUBLIC_SELECT,
  });
  return row ?? null;
}
