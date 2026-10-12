/**
 * The tones a stat tile may carry.
 *
 * One vocabulary for both `StatCard` (dashboards) and `ReportStat` (reports), so
 * a number that is a problem looks the same wherever it is shown. The colours
 * are the design tokens, not palette literals: a restyle is a token change.
 */
export type StatTone =
  | "default"
  | "brand"
  | "success"
  | "warning"
  | "danger"
  | "info";

export const STAT_TONES = [
  "default",
  "brand",
  "success",
  "warning",
  "danger",
  "info",
] as const;

const CARD_CLASSES: Record<StatTone, string> = {
  default: "border-line bg-surface",
  brand: "border-brand-200 bg-gradient-to-br from-surface to-brand-50",
  success: "border-success-100 bg-success-50",
  warning: "border-warning-100 bg-warning-50",
  danger: "border-danger-100 bg-danger-50",
  info: "border-info-100 bg-info-50",
};

const VALUE_CLASSES: Record<StatTone, string> = {
  default: "text-ink",
  brand: "text-ink",
  success: "text-success-700",
  warning: "text-warning-700",
  danger: "text-danger-700",
  info: "text-info-700",
};

export function statCardClasses(tone: StatTone = "default"): string {
  return CARD_CLASSES[tone] ?? CARD_CLASSES.default;
}

export function statValueClasses(tone: StatTone = "default"): string {
  return VALUE_CLASSES[tone] ?? VALUE_CLASSES.default;
}
