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
  neutral: "bg-slate-100 text-slate-700",
  sky: "bg-sky-100 text-sky-800",
  violet: "bg-violet-100 text-violet-800",
  amber: "bg-amber-100 text-amber-800",
  green: "bg-emerald-100 text-emerald-800",
  gray: "bg-slate-200 text-slate-700",
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

const STATUS_TONE: Record<string, Tone> = {
  SUBMITTED: "sky",
  ASSIGNED: "violet",
  IN_PROGRESS: "amber",
  RESOLVED: "green",
  CLOSED: "gray",
};

const PRIORITY_TONE: Record<string, Tone> = {
  LOW: "neutral",
  MEDIUM: "blue",
  HIGH: "orange",
  CRITICAL: "red",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge tone={STATUS_TONE[status] ?? "neutral"}>{status}</Badge>
  );
}

export function PriorityBadge({ level }: { level: string }) {
  return (
    <Badge tone={PRIORITY_TONE[level] ?? "neutral"}>{level}</Badge>
  );
}