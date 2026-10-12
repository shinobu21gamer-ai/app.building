import { cn } from "@/lib/utils";

/**
 * Table primitives. On a phone a wide table cannot be read, so the wrapper
 * scrolls horizontally edge to edge (`-mx-4`) while the rest of the page keeps
 * its padding; the sticky header keeps the meaning of a column in sight.
 */
export function Table({
  children,
  className,
  stack,
  minWidthClass = "min-w-[36rem]",
}: {
  children: React.ReactNode;
  className?: string;
  /** Below md, turn each row into a card whose lines come from `TD label`. */
  stack?: boolean;
  minWidthClass?: string;
}) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <table
        data-stack={stack ? "" : undefined}
        className={cn(
          "w-full border-collapse text-left text-sm",
          minWidthClass,
          className
        )}
      >
        {children}
      </table>
    </div>
  );
}

export function THead({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <thead
      className={cn(
        "bg-surface-sunken text-caption font-semibold uppercase tracking-wide text-ink-subtle",
        className
      )}
    >
      {children}
    </thead>
  );
}

export function TBody({ children }: { children: React.ReactNode }) {
  return <tbody>{children}</tbody>;
}

export function TR({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <tr
      className={cn(
        "border-t border-line align-top transition-colors hover:bg-surface-muted",
        className
      )}
    >
      {children}
    </tr>
  );
}

export function TH({
  children,
  align,
  className,
}: {
  children?: React.ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cn(
        "whitespace-nowrap px-3 py-2.5",
        align === "right" && "text-right",
        className
      )}
    >
      {children}
    </th>
  );
}

export function TD({
  children,
  align,
  label,
  className,
}: {
  children?: React.ReactNode;
  align?: "left" | "right";
  /** Column heading, shown in front of the value when the table is stacked. */
  label?: string;
  className?: string;
}) {
  return (
    <td
      data-label={label}
      className={cn(
        "px-3 py-2.5 text-ink-muted",
        align === "right" && "text-right tabular-nums",
        className
      )}
    >
      {children}
    </td>
  );
}
