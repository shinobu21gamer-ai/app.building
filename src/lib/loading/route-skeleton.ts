/**
 * Routing helpers for loading states. Kept free of React and Next.js imports so
 * the rules can be unit-tested and shared by the navigation overlay and the
 * route-level `loading.tsx` fallbacks.
 */

export type SkeletonVariant =
  | "landing"
  | "article"
  | "auth"
  | "form"
  | "list"
  | "table"
  | "dashboard"
  | "detail"
  | "default";

/** Role areas render their section nav in a shared layout. */
const ROLE_PREFIXES = ["/resident", "/official", "/admin"] as const;

/** Drops the query string, hash and any trailing slash (but keeps "/"). */
export function normalizePathname(pathname: string): string {
  const withoutQueryOrHash = pathname.split(/[?#]/)[0] ?? "";
  const trimmed = withoutQueryOrHash.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

/**
 * A stable identity for "which page + filters is on screen". Two URLs that
 * differ only by trailing slash or query-string encoding resolve to the same
 * key, so a navigation to the page you are already on never starts a loader.
 */
export function routeKeyFor(pathname: string, search: string): string {
  const path = normalizePathname(pathname);
  const query = new URLSearchParams(search.replace(/^\?/, "")).toString();
  return query ? `${path}?${query}` : path;
}

/** Whether a route renders inside a role layout, and so has the section nav. */
export function hasRoleNav(pathname: string): boolean {
  const path = normalizePathname(pathname);
  return ROLE_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`)
  );
}

/** Picks the skeleton shape that resembles the page a route will render. */
export function routeSkeletonVariant(pathname: string): SkeletonVariant {
  const path = normalizePathname(pathname);
  const [root, section, detail] = path.split("/").filter(Boolean);

  if (path === "/") return "landing";
  if (path === "/help" || path === "/privacy") return "article";
  if (path === "/login" || path === "/reset-password") return "auth";
  if (path === "/register" || path === "/profile" || path === "/track") {
    return "form";
  }
  if (path === "/notifications" || path === "/alerts") return "list";
  if (
    path === "/resident" ||
    path === "/official" ||
    path === "/admin" ||
    path === "/admin/reports"
  ) {
    return "dashboard";
  }

  if (root === "resident" || root === "official") {
    if (section === "concerns") {
      if (!detail) return "list";
      if (detail === "new") return "form";
      return "detail";
    }
  }

  if (root === "admin") {
    if (section === "priority" || section === "settings") return "form";
    return "table";
  }

  return "default";
}
