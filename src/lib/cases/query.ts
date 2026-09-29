import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { isCaseStatus, PRIORITY_LEVELS } from "@/lib/cases/workflow";

export type ConcernListFilters = {
  q: string | null;
  status: string | null;
  priority: string | null;
  categoryId: number | null;
  // Inclusive lower bound on createdAt.
  from: Date | null;
  // Exclusive upper bound on createdAt (the day after the requested "to").
  to: Date | null;
  // Restrict to a single assigned office. null means no office restriction.
  officeId: number | null;
};

type RawParams =
  | URLSearchParams
  | Record<string, string | string[] | undefined>;

function readParam(params: RawParams, key: string): string | null {
  if (params instanceof URLSearchParams) return params.get(key);
  const value = params[key];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function nonEmpty(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function toPositiveInt(value: string | null): number | null {
  if (!value) return null;
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

// Dates are interpreted in Asia/Manila (UTC+8) to match how timestamps are
// displayed to users, independent of the server's timezone.
const MANILA_OFFSET = "+08:00";

function parseManilaDate(value: string | null): Date | null {
  if (!value || !DATE_ONLY.test(value)) return null;
  const date = new Date(`${value}T00:00:00${MANILA_OFFSET}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseConcernFilters(params: RawParams): ConcernListFilters {
  const from = parseManilaDate(nonEmpty(readParam(params, "from")));
  const toStart = parseManilaDate(nonEmpty(readParam(params, "to")));

  const status = nonEmpty(readParam(params, "status"));
  const priority = nonEmpty(readParam(params, "priority"))?.toUpperCase() ?? null;

  return {
    q: nonEmpty(readParam(params, "q")),
    status: status && isCaseStatus(status.toUpperCase()) ? status.toUpperCase() : null,
    priority:
      priority && (PRIORITY_LEVELS as readonly string[]).includes(priority)
        ? priority
        : null,
    categoryId: toPositiveInt(nonEmpty(readParam(params, "categoryId"))),
    from,
    to: toStart ? new Date(toStart.getTime() + 24 * 60 * 60 * 1000) : null,
    officeId: toPositiveInt(nonEmpty(readParam(params, "officeId"))),
  };
}

export function buildConcernWhere(
  filters: ConcernListFilters
): Prisma.ConcernWhereInput {
  const where: Prisma.ConcernWhereInput = {};

  if (filters.status) where.status = filters.status;
  if (filters.priority) where.priorityLevel = filters.priority;
  if (filters.categoryId) where.categoryId = filters.categoryId;
  if (filters.officeId) where.assignedOfficeId = filters.officeId;

  if (filters.from || filters.to) {
    where.createdAt = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to ? { lt: filters.to } : {}),
    };
  }

  if (filters.q) {
    where.OR = [
      { caseNumber: { contains: filters.q } },
      { title: { contains: filters.q } },
      { description: { contains: filters.q } },
      { locationAddress: { contains: filters.q } },
      {
        user: {
          is: {
            OR: [
              { firstName: { contains: filters.q } },
              { lastName: { contains: filters.q } },
              { email: { contains: filters.q } },
            ],
          },
        },
      },
    ];
  }

  return where;
}

export const CONCERN_LIST_LIMIT = 200;

export type ConcernListItem = Awaited<
  ReturnType<typeof listConcerns>
>["concerns"][number];

export async function listConcerns(filters: ConcernListFilters) {
  const where = buildConcernWhere(filters);

  const [concerns, total] = await Promise.all([
    db.concern.findMany({
      where,
      include: {
        category: true,
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        assignedOffice: true,
        assignedOfficial: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: CONCERN_LIST_LIMIT,
    }),
    db.concern.count({ where }),
  ]);

  return { concerns, total, truncated: total > CONCERN_LIST_LIMIT };
}
