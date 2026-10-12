/**
 * Navigation helpers shared by the header, the desktop sidebar and the mobile
 * tab bar. Pure functions on purpose: the shell is the part of the revamp that
 * every portal inherits, so the rules that decide "which tab is lit" are
 * unit-tested rather than eyeballed in six layouts.
 */

export type NavItem = {
  href: string;
  label: string;
};

/**
 * The item that owns the current path. The longest matching href wins, so
 * `/admin/sla` lights the SLA desk and not the dashboard at `/admin`.
 * `/` only ever matches exactly — otherwise every page would match it.
 */
export function activeHrefFor(
  pathname: string,
  items: readonly NavItem[]
): string | null {
  const matches = items.filter((item) => {
    if (item.href === "/") return pathname === "/";
    return pathname === item.href || pathname.startsWith(`${item.href}/`);
  });

  if (matches.length === 0) return null;

  return matches.reduce((best, item) =>
    item.href.length > best.href.length ? item : best
  ).href;
}

/**
 * Splits a role's nav for the two shells: a handful of primary destinations
 * become the bottom tab bar, everything else lives behind "More". Keeping the
 * first items (which each layout lists most-used first) rather than picking by
 * weight means a role can reorder its own tabs by reordering its layout.
 */
export function partitionNav<T extends NavItem>(
  items: readonly T[],
  maxTabs = 4
): { tabs: T[]; more: T[] } {
  const limit = Math.max(1, maxTabs);
  if (items.length <= limit + 1) return { tabs: [...items], more: [] };
  return { tabs: items.slice(0, limit), more: items.slice(limit) };
}

/**
 * A stable key for the glyph a nav destination gets in the tab bar. Derived
 * from the last path segment so a new desk gets an icon without touching the
 * shell; the component maps the key to a lucide icon and falls back to a grid.
 */
export function navIconKey(href: string): string {
  const segments = href.split("/").filter(Boolean);
  if (segments.length === 0) return "home";
  return segments[segments.length - 1];
}
