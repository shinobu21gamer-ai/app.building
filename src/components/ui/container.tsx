import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type ContainerSize = "full" | "wide" | "narrow";

/**
 * Page-width primitive — the single place that decides how much of the screen
 * the app's data gets.
 *
 * Every surface is wrapped in this: site header, site footer, the role shell
 * around all six portals, and each public page (home, help, privacy, track,
 * transparency, alerts, notifications). It used to cap at `max-w-6xl` (72rem),
 * which left tables, dashboards and lists floating in a narrow column down the
 * middle of the window with dead gutters on both sides — on a 1366px laptop
 * that threw away ~18% of the width, on a 1920px desktop ~40%.
 *
 * The default is now genuinely full width: content spans the viewport and
 * keeps only modest, breakpoint-scaled padding. Long-form copy, focused forms
 * and print sheets constrain their own readable measure at the point where
 * that content needs it, while dashboard cards and data tables get the screen
 * width they need.
 *
 * `wide` and `narrow` stay available for the few surfaces that must not
 * stretch (a print sheet, one focused form).
 */
const SIZE_CLASS: Record<ContainerSize, string> = {
  full: "max-w-none",
  wide: "max-w-5xl",
  narrow: "max-w-2xl",
};

/** True when the caller brings its own `max-w-*`, which has to win. */
function setsOwnWidth(className?: string): boolean {
  return Boolean(className && /(?:^|\s)max-w-/.test(className));
}

export function Container({
  className,
  children,
  size = "full",
  ...rest
}: Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  children: ReactNode;
  /** Defaults to `full` (edge to edge). See SIZE_CLASS. */
  size?: ContainerSize;
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-4 sm:px-6 lg:px-8",
        // `cn` concatenates class strings (no Tailwind merge), so a
        // caller-supplied max-width must replace the size class rather than
        // sit beside it and let the cascade pick a winner.
        !setsOwnWidth(className) && SIZE_CLASS[size],
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
