import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Visible status message for an in-progress navigation. It is the only
 * announced element in a loading state, so screen readers hear one "Loading"
 * instead of every skeleton block.
 */
export function LoadingPill({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-lg shadow-slate-900/5 animate-fade-in",
        className
      )}
    >
      <LoaderCircle
        aria-hidden="true"
        className="h-4 w-4 animate-spin text-brand-600"
      />
      <span>{label}</span>
    </div>
  );
}
