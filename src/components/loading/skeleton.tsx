import { cn } from "@/lib/utils";

/**
 * A shimmering placeholder block. It is decorative, so callers wrap skeleton
 * trees in an aria-hidden element and announce loading with <LoadingPill/>.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton rounded-md", className)} />;
}
