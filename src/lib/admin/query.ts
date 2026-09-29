import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ADMIN_ROLE_KEYS } from "@/lib/validations/admin";

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

function parseActive(value: string | null): boolean | null {
  if (value === "active") return true;
  if (value === "disabled") return false;
  return null;
}

// ---------------------------------------------------------------
// Users / officials
// ---------------------------------------------------------------

export type AdminUserFilters = {
  q: string | null;
  role: string | null;
  active: boolean | null;
};

export function parseUserFilters(params: RawParams): AdminUserFilters {
  const role = nonEmpty(readParam(params, "role"))?.toUpperCase() ?? null;
  return {
    q: nonEmpty(readParam(params, "q")),
    role:
      role && (ADMIN_ROLE_KEYS as readonly string[]).includes(role) ? role : null,
    active: parseActive(nonEmpty(readParam(params, "status"))),
  };
}

// Every admin list is bounded so a large table can never produce one
// unbounded response or OOM the server. Ordering is deterministic so the
// first page is stable across requests.
const ADMIN_LIST_LIMIT = 500;

export const USER_COUNT_SELECT = {
  submittedConcerns: true,
  resolutionsRecorded: true,
  historyEntries: true,
  auditEntries: true,
  assignmentOfficial: true,
} satisfies Prisma.UserCountOutputTypeSelect;

export async function listAdminUsers(filters: AdminUserFilters) {
  const where: Prisma.UserWhereInput = {};
  if (filters.role) where.role = { key: filters.role };
  if (filters.active !== null) where.isActive = filters.active;
  if (filters.q) {
    where.OR = [
      { email: { contains: filters.q } },
      { firstName: { contains: filters.q } },
      { lastName: { contains: filters.q } },
    ];
  }

  return db.user.findMany({
    where,
    include: {
      role: true,
      office: true,
      _count: { select: USER_COUNT_SELECT },
    },
    orderBy: [{ roleId: "asc" }, { lastName: "asc" }, { firstName: "asc" }],
    take: ADMIN_LIST_LIMIT,
  });
}

export async function countsForUser(id: number) {
  const row = await db.user.findUnique({
    where: { id },
    select: { _count: { select: USER_COUNT_SELECT } },
  });
  if (!row) return null;
  const c = row._count;
  const total =
    c.submittedConcerns +
    c.resolutionsRecorded +
    c.historyEntries +
    c.auditEntries +
    c.assignmentOfficial;
  return {
    concerns: c.submittedConcerns,
    resolutions: c.resolutionsRecorded,
    history: c.historyEntries,
    audits: c.auditEntries,
    assignments: c.assignmentOfficial,
    total,
  };
}

export async function countActiveAdmins(): Promise<number> {
  return db.user.count({ where: { isActive: true, role: { key: "ADMIN" } } });
}

type AdminUserRow = Awaited<ReturnType<typeof listAdminUsers>>[number];

/** Safe admin-facing user shape: never exposes the password hash. */
export function adminUserView(user: AdminUserRow) {
  const c = user._count;
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    address: user.address,
    isActive: user.isActive,
    createdAt: user.createdAt.toISOString(),
    role: { id: user.role.id, key: user.role.key, name: user.role.name },
    office: user.office
      ? { id: user.office.id, name: user.office.name, code: user.office.code }
      : null,
    references: {
      concerns: c.submittedConcerns,
      resolutions: c.resolutionsRecorded,
      history: c.historyEntries,
      audits: c.auditEntries,
      assignments: c.assignmentOfficial,
      total:
        c.submittedConcerns +
        c.resolutionsRecorded +
        c.historyEntries +
        c.auditEntries +
        c.assignmentOfficial,
    },
  };
}

// ---------------------------------------------------------------
// Offices
// ---------------------------------------------------------------

export type AdminNameFilters = { q: string | null; active: boolean | null };

export function parseNameFilters(params: RawParams): AdminNameFilters {
  return {
    q: nonEmpty(readParam(params, "q")),
    active: parseActive(nonEmpty(readParam(params, "status"))),
  };
}

export const OFFICE_COUNT_SELECT = {
  concerns: true,
  assignments: true,
  routingRules: true,
  users: true,
} satisfies Prisma.OfficeCountOutputTypeSelect;

export async function listAdminOffices(filters: AdminNameFilters) {
  const where: Prisma.OfficeWhereInput = {};
  if (filters.active !== null) where.isActive = filters.active;
  if (filters.q) {
    where.OR = [
      { name: { contains: filters.q } },
      { code: { contains: filters.q } },
    ];
  }

  return db.office.findMany({
    where,
    include: { _count: { select: OFFICE_COUNT_SELECT } },
    orderBy: { name: "asc" },
    take: ADMIN_LIST_LIMIT,
  });
}

export async function countsForOffice(id: number) {
  const row = await db.office.findUnique({
    where: { id },
    select: { _count: { select: OFFICE_COUNT_SELECT } },
  });
  if (!row) return null;
  const c = row._count;
  return {
    concerns: c.concerns,
    assignments: c.assignments,
    routingRules: c.routingRules,
    users: c.users,
    total: c.concerns + c.assignments + c.routingRules + c.users,
  };
}

// ---------------------------------------------------------------
// Concern categories
// ---------------------------------------------------------------

export const CATEGORY_COUNT_SELECT = {
  concerns: true,
  routingRules: true,
} satisfies Prisma.ConcernCategoryCountOutputTypeSelect;

export async function listAdminCategories(filters: AdminNameFilters) {
  const where: Prisma.ConcernCategoryWhereInput = {};
  if (filters.active !== null) where.isActive = filters.active;
  if (filters.q) {
    where.OR = [
      { name: { contains: filters.q } },
      { code: { contains: filters.q } },
    ];
  }

  return db.concernCategory.findMany({
    where,
    include: { _count: { select: CATEGORY_COUNT_SELECT } },
    orderBy: { name: "asc" },
    take: ADMIN_LIST_LIMIT,
  });
}

export async function countsForCategory(id: number) {
  const row = await db.concernCategory.findUnique({
    where: { id },
    select: { _count: { select: CATEGORY_COUNT_SELECT } },
  });
  if (!row) return null;
  const c = row._count;
  return {
    concerns: c.concerns,
    routingRules: c.routingRules,
    total: c.concerns + c.routingRules,
  };
}

// ---------------------------------------------------------------
// Serializers (used by both server pages and API routes)
// ---------------------------------------------------------------

type AdminOfficeRow = Awaited<ReturnType<typeof listAdminOffices>>[number];

export function adminOfficeView(office: AdminOfficeRow) {
  const c = office._count;
  return {
    id: office.id,
    name: office.name,
    code: office.code,
    description: office.description,
    headOfficer: office.headOfficer,
    contact: office.contact,
    isActive: office.isActive,
    references: {
      concerns: c.concerns,
      assignments: c.assignments,
      routingRules: c.routingRules,
      users: c.users,
      total: c.concerns + c.assignments + c.routingRules + c.users,
    },
  };
}

type AdminCategoryRow = Awaited<ReturnType<typeof listAdminCategories>>[number];

export function adminCategoryView(category: AdminCategoryRow) {
  const c = category._count;
  return {
    id: category.id,
    name: category.name,
    code: category.code,
    description: category.description,
    isActive: category.isActive,
    references: {
      concerns: c.concerns,
      routingRules: c.routingRules,
      total: c.concerns + c.routingRules,
    },
  };
}
