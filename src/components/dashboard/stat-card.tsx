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
        "rounded-xl border p-5 shadow-sm",
        tone === "brand"
          ? "border-brand-200 bg-gradient-to-br from-white to-brand-50"
          : "border-slate-200 bg-white"
      )}
    >
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-3xl font-bold tabular-nums text-slate-900">
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}
