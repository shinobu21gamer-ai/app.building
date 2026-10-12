import { cn } from "@/lib/utils";

/**
 * What a list shows when it has nothing to show. A blank panel reads as a bug;
 * this says which list is empty and what to do about it.
 */
export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 rounded-card border border-dashed border-line-strong bg-surface-muted px-6 py-10 text-center",
        className
      )}
    >
      <p className="text-sm font-semibold text-ink-muted">{title}</p>
      {description ? (
        <p className="max-w-md text-sm text-ink-subtle">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
