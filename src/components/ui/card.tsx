import { cn } from "@/lib/utils";

type CardProps = {
  title?: string;
  description?: string;
  /** Buttons or links that act on the whole panel; they sit in the header. */
  actions?: React.ReactNode;
  className?: string;
  /** Removes the inner padding, for cards whose body is a table. */
  flush?: boolean;
  children: React.ReactNode;
};

export function Card({
  title,
  description,
  actions,
  className,
  flush = false,
  children,
}: CardProps) {
  const hasHeader = Boolean(title || description || actions);

  return (
    <section
      className={cn(
        "rounded-card border border-line bg-surface shadow-card",
        className
      )}
    >
      {hasHeader && (
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3.5 sm:px-5">
          <div className="min-w-0">
            {title && (
              <h2 className="text-subtitle text-ink">{title}</h2>
            )}
            {description && (
              <p className="mt-0.5 text-sm leading-relaxed text-ink-subtle">
                {description}
              </p>
            )}
          </div>
          {actions ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {actions}
            </div>
          ) : null}
        </div>
      )}
      <div className={flush ? "" : "px-4 py-4 sm:px-5"}>{children}</div>
    </section>
  );
}
