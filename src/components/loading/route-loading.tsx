"use client";

import { usePathname } from "next/navigation";
import { routeSkeletonVariant } from "@/lib/loading/route-skeleton";
import { LoadingPill } from "./loading-pill";
import { PageSkeleton } from "./page-skeleton";

/**
 * Fallback for `loading.tsx` files. It renders inside the segment's layout, so
 * the section nav is already on screen and no nav placeholder is drawn.
 */
export function RouteLoading({ label }: { label: string }) {
  const pathname = usePathname();

  return (
    <div>
      <div className="flex justify-center px-4 pt-6 sm:px-6">
        <LoadingPill label={label} />
      </div>
      <PageSkeleton variant={routeSkeletonVariant(pathname)} />
    </div>
  );
}
