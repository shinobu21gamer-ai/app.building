const RETURN_PATHS_BY_ROLE: Record<string, ReadonlySet<string>> = {
  OFFICIAL: new Set(["/official", "/official/concerns"]),
  ADMIN: new Set([
    "/admin",
    "/admin/validation",
    "/admin/field-checks",
    "/admin/verification",
    "/official/concerns",
  ]),
  CAPTAIN: new Set([
    "/captain",
    "/captain/closure",
    "/captain/approvals",
    "/captain/escalations",
  ]),
  TREASURER: new Set([
    "/treasury",
    "/treasury/fund",
    "/treasury/disbursements",
    "/treasury/earmarks",
    "/treasury/budgets",
    "/treasury/ledger",
  ]),
};

const DEFAULT_CASE_DESK: Record<string, string> = {
  OFFICIAL: "/official/concerns",
  ADMIN: "/admin/validation",
  CAPTAIN: "/captain",
  TREASURER: "/treasury",
};

/**
 * Keep a case-sheet back link inside the signed-in role's known desks. The
 * query parameter is user-controlled, so accept only same-origin relative URLs
 * whose path is explicitly in that role's return allowlist.
 */
export function caseReturnHref(
  role: string,
  candidate: string | string[] | null | undefined,
): string {
  const fallback = DEFAULT_CASE_DESK[role] ?? "/";
  const value = Array.isArray(candidate) ? candidate[0] : candidate;
  if (!value || value.length > 2_000) return fallback;

  try {
    const base = new URL("https://return.invalid");
    const url = new URL(value, base);
    if (url.origin !== base.origin) return fallback;
    if (!RETURN_PATHS_BY_ROLE[role]?.has(url.pathname)) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
