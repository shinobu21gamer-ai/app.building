/**
 * CSV building for exports.
 *
 * Two rules matter more than formatting here:
 *
 * 1. **Formula injection.** A cell that begins with `=`, `+`, `-`, `@`, a tab
 *    or a carriage return is executed as a formula when the file is opened in
 *    Excel or Google Sheets. Resident-supplied text (a case title, a payee name)
 *    reaches these exports, so every leading character of that kind is prefixed
 *    with an apostrophe and the cell renders as text.
 * 2. **Quoting.** Every cell is quoted and inner quotes are doubled, so a name
 *    containing a comma, a quote or a line break cannot shift a row.
 *
 * No dependency on Next is allowed in this module: it is pure, so it can be
 * unit-tested and reused by any export (route handler, cron job, script).
 */

export type CsvValue = string | number | boolean | Date | null | undefined;

function escapeCell(text: string): string {
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${guarded.replaceAll('"', '""')}"`;
}

/** One CSV cell: stringified, formula-guarded and quoted. */
export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return '""';
  if (value instanceof Date) return escapeCell(value.toISOString());
  if (typeof value === "number") {
    return escapeCell(Number.isFinite(value) ? String(value) : "");
  }
  if (typeof value === "boolean") return escapeCell(value ? "yes" : "no");
  return escapeCell(value);
}

/** Row lines only, no header: the unit `toCsv` and the streamer both build on. */
export function csvRows(rows: readonly (readonly CsvValue[])[]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

/** A full CSV document: header row first, then one line per row. */
export function toCsv(
  columns: readonly string[],
  rows: readonly (readonly CsvValue[])[]
): string {
  const lines = [columns.map(csvCell).join(",")];
  if (rows.length > 0) lines.push(csvRows(rows));
  // A trailing newline keeps `cat`/`wc -l` honest and is valid CSV.
  return `${lines.join("\n")}\n`;
}

/** `barangayresolve-<slug>-2026-10-12.csv`. The slug is sanitised, not trusted. */
export function csvFilename(slug: string, at: Date = new Date()): string {
  const safe = slug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `barangayresolve-${safe || "export"}-${at.toISOString().slice(0, 10)}.csv`;
}
