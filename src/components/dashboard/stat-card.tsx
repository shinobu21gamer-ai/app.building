import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: number | string;
  hint?: string;
  tone?: "default" | "brand";
}) {
  return (
    <div
      className={cn(
        "rounded-card border p-5 shadow-card",
        tone === "brand"
          ? "border-brand-200 bg-gradient-to-br from-white to-brand-50"
          : "border-line bg-surface"
      )}
    >
      <p className="text-sm text-ink-subtle">{label}</p>
      <p className="mt-1 text-3xl font-bold tabular-nums text-ink">
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-ink-subtle">{hint}</p>}
    </div>
  );
}
