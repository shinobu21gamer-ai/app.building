import { cn } from "@/lib/utils";

export type BarItem = {
  label: string;
  value: number;
  tone?: BarTone;
};

export type BarTone =
  | "brand"
  | "sky"
  | "violet"
  | "amber"
  | "green"
  | "red"
  | "slate";

const TONE_FILL: Record<BarTone, string> = {
  brand: "bg-brand-600",
  sky: "bg-sky-500",
  violet: "bg-violet-500",
  amber: "bg-amber-500",
  green: "bg-emerald-500",
  red: "bg-red-500",
  slate: "bg-slate-400",
};

/**
 * A dependency-free horizontal bar chart. Each bar is scaled against the
 * largest value in the set; values are always rendered so the chart stays
 * readable (and testable) even for very small datasets.
 */
export function BarChart({
  items,
  emptyLabel = "No data yet.",
}: {
  items: BarItem[];
  emptyLabel?: string;
}) {
  if (items.length === 0) {
    return <p className="py-6 text-center text-sm text-slate-500">{emptyLabel}</p>;
  }

  const max = Math.max(1, ...items.map((item) => item.value));

  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item.label}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate text-slate-700">{item.label}</span>
            <span className="font-semibold text-slate-900">{item.value}</span>
          </div>
          <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className={cn(
                "h-full rounded-full transition-[width]",
                TONE_FILL[item.tone ?? "brand"]
              )}
              style={{ width: `${(item.value / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
