/**
 * The reports this app can produce.
 *
 * Kept in one place because three things must agree on the list: the API route
 * (`/api/v1/reports/{report}`), the screens that tab between them, and the copy
 * keys (`revamp.reports.tabs.*`). A name that drifts out of step here is a
 * compile error rather than a 404 at runtime.
 */

export const REPORT_KEYS = [
  "engineering",
  "treasury",
  "privacy",
  "transparency",
] as const;

export type ReportKey = (typeof REPORT_KEYS)[number];

/** A tab in a report screen: the four reports, plus the admin case list. */
export const REPORT_TAB_KEYS = [...REPORT_KEYS, "concerns"] as const;

export type ReportTabKey = (typeof REPORT_TAB_KEYS)[number];

export function isReportKey(value: string): value is ReportKey {
  return (REPORT_KEYS as readonly string[]).includes(value);
}

/**
 * Tab links for a report screen: `concerns` is the section's own index page
 * (the case register), the four reports are sub-paths of it.
 */
export function reportTabs(
  basePath: string,
  keys: readonly ReportTabKey[]
): { key: ReportTabKey; href: string }[] {
  return keys.map((key) => ({
    key,
    href: key === "concerns" ? basePath : `${basePath}/${key}`,
  }));
}

/** Who may open which report. The API enforces this; the UI only hides links. */
export const REPORT_PERMISSIONS: Record<ReportKey, string> = {
  engineering: "report.view.office",
  treasury: "report.view.treasury",
  privacy: "privacy.pii_access.view",
  transparency: "report.view.office",
};
