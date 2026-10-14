import type { Prisma } from "@prisma/client";
import { CASE_STATUSES } from "@/lib/cases/workflow";
export const RESIDENT_PAGE_SIZE = 20;
export function residentSearch(input: { q?: string | string[]; status?: string | string[]; page?: string | string[] }) {
  const q = typeof input.q === "string" ? input.q.trim().slice(0, 100) : "";
  const status = typeof input.status === "string" && (CASE_STATUSES as readonly string[]).includes(input.status) ? input.status : "";
  const parsed = typeof input.page === "string" && /^\d+$/.test(input.page) ? Number(input.page) : 1;
  const page = Number.isSafeInteger(parsed) ? Math.max(1, Math.min(parsed, 100_000)) : 1;
  return { q, status, page };
}
export function residentConcernWhere(userId: number, search: ReturnType<typeof residentSearch>): Prisma.ConcernWhereInput {
  return {
    userId,
    ...(search.status ? { status: search.status } : {}),
    ...(search.q ? { OR: [
      { caseNumber: { contains: search.q, mode: "insensitive" } },
      { title: { contains: search.q, mode: "insensitive" } },
    ] } : {}),
  };
}
export function residentSearchHref(search: ReturnType<typeof residentSearch>, page: number) {
  const params = new URLSearchParams();
  if (search.q) params.set("q", search.q);
  if (search.status) params.set("status", search.status);
  params.set("page", String(page));
  return `/resident/concerns?${params.toString()}`;
}
