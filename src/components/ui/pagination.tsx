import Link from "next/link";

import { cn } from "@/lib/utils";

const linkClass =
  "tap-target inline-flex items-center justify-center rounded-control border border-line bg-surface px-3 text-sm font-medium text-ink-muted transition-colors hover:border-line-strong hover:text-ink";
const disabledClass =
  "tap-target inline-flex items-center justify-center rounded-control border border-line bg-surface-muted px-3 text-sm font-medium text-ink-subtle/60";

/**
 * Page-sized paging for lists that are read on a phone as often as on a
 * desktop: two large targets, and a plain "showing 51–100 of 438" in between.
 * `hrefFor` keeps the caller's existing filters in the URL.
 */
export function Pagination({
  page,
  pageCount,
  total,
  pageSize,
  showingLabel,
  previousLabel,
  nextLabel,
  hrefFor,
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  showingLabel: string;
  previousLabel: string;
  nextLabel: string;
  hrefFor: (page: number) => string;
}) {
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  const hasPrevious = page > 1;
  const hasNext = page < pageCount;
  // Interpolated once so the visible text and the screen-reader label never
  // disagree — the raw "{from}-{to} of {total}" template is not useful to
  // announce as-is.
  const resolvedShowingLabel = showingLabel
    .replace("{from}", String(first))
    .replace("{to}", String(last))
    .replace("{total}", String(total));

  return (
    <nav
      aria-label={resolvedShowingLabel}
      className="no-print mt-4 flex flex-wrap items-center justify-between gap-3"
    >
      {hasPrevious ? (
        <Link href={hrefFor(page - 1)} className={linkClass} rel="prev">
          {previousLabel}
        </Link>
      ) : (
        <span className={disabledClass} aria-disabled="true">
          {previousLabel}
        </span>
      )}

      <p className="text-caption text-ink-subtle tabular-nums">
        {resolvedShowingLabel}
      </p>

      {hasNext ? (
        <Link href={hrefFor(page + 1)} className={linkClass} rel="next">
          {nextLabel}
        </Link>
      ) : (
        <span className={cn(disabledClass, "")} aria-disabled="true">
          {nextLabel}
        </span>
      )}
    </nav>
  );
}
