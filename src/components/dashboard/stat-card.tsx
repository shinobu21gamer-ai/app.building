import { cn } from "@/lib/utils";
import {
  statCardClasses,
  statValueClasses,
  type StatTone,
} from "@/lib/design/tones";

/**
 * A dashboard figure. The tone vocabulary is shared with the reports
 * (`src/lib/design/tones.ts`), so "this number is a problem" looks the same on a
 * dashboard and in a report.
 */
export function StatCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: number | string;
  hint?: string;
  tone?: StatTone;
}) {
  return (
    <div
      className={cn("rounded-card border p-5 shadow-card", statCardClasses(tone))}
    >
      <p className="text-sm text-ink-subtle">{label}</p>
      <p
        className={cn(
          "mt-1 text-3xl font-bold tabular-nums",
          statValueClasses(tone)
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-ink-subtle">{hint}</p>}
    </div>
  );
}
