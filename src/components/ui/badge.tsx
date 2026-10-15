import { statusLabel } from "@/lib/cases/workflow";
import { statusLabelFor, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type Tone =
  | "neutral"
  | "sky"
  | "violet"
  | "amber"
  | "green"
  | "gray"
  | "red"
  | "blue"
  | "orange";

const toneStyles: Record<Tone, string> = {
  neutral: "bg-surface-sunken text-ink",
  sky: "bg-sky-100 text-sky-800",
  violet: "bg-violet-100 text-violet-800",
  amber: "bg-amber-100 text-amber-800",
  green: "bg-emerald-100 text-emerald-800",
  gray: "bg-line text-ink",
  red: "bg-red-100 text-red-800",
  blue: "bg-blue-100 text-blue-800",
  orange: "bg-orange-100 text-orange-800",
};

export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap",
        toneStyles[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

/**
 * One tone per status of the seven-stage workflow, ordered the way a reader
 * scans a list: cool for "not started", warm for "work happening", green for
 * done, grey for closed.
 */
const STATUS_TONE: Record<string, Tone> = {
  SUBMITTED: "sky",
  ASSIGNED: "violet",
  UNDER_ASSESSMENT: "blue",
  AWAITING_BUDGET: "amber",
  IN_PROGRESS: "orange",
  RESOLVED: "green",
  CLOSED: "gray",
};

const PRIORITY_TONE: Record<string, Tone> = {
  LOW: "neutral",
  MEDIUM: "blue",
  HIGH: "orange",
  CRITICAL: "red",
};

export function StatusBadge({
  status,
  label,
  locale,
}: {
  status: string;
  label?: string;
  /** When set, the badge uses the reader's language instead of the raw key. */
  locale?: Locale;
}) {
  const text =
    label ??
    (locale ? statusLabelFor(locale, status) : statusLabel(status));
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{text}</Badge>;
}

export function PriorityBadge({
  level,
  label,
}: {
  level: string;
  label?: string;
}) {
  return <Badge tone={PRIORITY_TONE[level] ?? "neutral"}>{label ?? level}</Badge>;
}
