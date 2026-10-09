import { cn } from "@/lib/utils";
import type { SkeletonVariant } from "@/lib/loading/route-skeleton";
import { Skeleton } from "./skeleton";

/**
 * Placeholder layouts for each kind of page. Every variant mirrors the real
 * page's outline (heading, cards, tables, forms) so the swap-in is quiet.
 * Tailwind needs complete class names in source, hence the literal arrays.
 */
export function PageSkeleton({
  variant,
  withNav = false,
  className,
}: {
  variant: SkeletonVariant;
  /** The role section nav sits under the overlay, so draw a placeholder for it. */
  withNav?: boolean;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn("mx-auto w-full max-w-6xl px-4 py-8 sm:px-6", className)}
    >
      {withNav ? <NavSkeleton /> : null}
      <VariantBody variant={variant} />
    </div>
  );
}

function VariantBody({ variant }: { variant: SkeletonVariant }) {
  switch (variant) {
    case "landing":
      return <LandingSkeleton />;
    case "article":
      return <ArticleSkeleton />;
    case "auth":
      return <AuthSkeleton />;
    case "form":
      return <FormSkeleton />;
    case "list":
      return <ListSkeleton />;
    case "table":
      return <TableSkeleton />;
    case "dashboard":
      return <DashboardSkeleton />;
    case "detail":
      return <DetailSkeleton />;
    default:
      return <DefaultSkeleton />;
  }
}

function NavSkeleton() {
  const widths = ["w-24", "w-28", "w-32", "w-24", "w-28"];
  return (
    <div className="mb-6 flex flex-wrap gap-1 border-b border-slate-200 pb-3">
      {widths.map((width, index) => (
        <Skeleton key={index} className={cn("h-8 rounded-lg", width)} />
      ))}
    </div>
  );
}

function Heading({ titleWidth = "w-56" }: { titleWidth?: string }) {
  return (
    <div className="space-y-2">
      <Skeleton className={cn("h-7", titleWidth)} />
      <Skeleton className="h-4 w-72 max-w-full" />
    </div>
  );
}

function FieldSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-3 w-28" />
      <Skeleton className="h-10 w-full rounded-lg" />
    </div>
  );
}

function StatSkeleton() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-4 h-8 w-20" />
      <Skeleton className="mt-3 h-3 w-36 max-w-full" />
    </div>
  );
}

function ToolbarSkeleton() {
  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 px-5 py-4">
      <Skeleton className="h-10 min-w-[200px] flex-1" />
      <Skeleton className="h-10 w-36" />
      <Skeleton className="h-10 w-36" />
    </div>
  );
}

function CardSkeleton({
  rows = 4,
  toolbar = false,
}: {
  rows?: number;
  toolbar?: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="space-y-2 border-b border-slate-100 px-5 py-4">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-64 max-w-full" />
      </div>
      {toolbar ? <ToolbarSkeleton /> : null}
      <div className="divide-y divide-slate-100">
        {Array.from({ length: rows }, (_, index) => (
          <div
            key={index}
            className="flex items-center justify-between gap-4 px-5 py-4"
          >
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-3.5 w-3/5" />
              <Skeleton className="h-3 w-2/5" />
            </div>
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <Heading titleWidth="w-64" />
        <Skeleton className="h-9 w-40 rounded-lg" />
      </div>
      <div className="stagger grid gap-4 sm:grid-cols-3">
        <StatSkeleton />
        <StatSkeleton />
        <StatSkeleton />
      </div>
      <div className="stagger grid gap-6 lg:grid-cols-2">
        <CardSkeleton rows={4} />
        <CardSkeleton rows={4} />
      </div>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Heading />
        <Skeleton className="h-9 w-36 rounded-lg" />
      </div>
      <CardSkeleton rows={6} toolbar />
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Heading />
        <Skeleton className="h-9 w-36 rounded-lg" />
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap items-end gap-3">
          <Skeleton className="h-10 min-w-[200px] flex-1" />
          <Skeleton className="h-10 w-36" />
          <Skeleton className="h-10 w-28" />
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="grid grid-cols-3 gap-4 border-b border-slate-100 bg-slate-50 px-5 py-3 sm:grid-cols-4">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-16" />
          <Skeleton className="hidden h-3 w-20 sm:block" />
        </div>
        {Array.from({ length: 8 }, (_, row) => (
          <div
            key={row}
            className="grid grid-cols-3 gap-4 border-b border-slate-100 px-5 py-4 last:border-b-0 sm:grid-cols-4"
          >
            <Skeleton className="h-3.5 w-4/5" />
            <Skeleton className="h-3.5 w-3/5" />
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="hidden h-3.5 w-1/2 sm:block" />
          </div>
        ))}
      </div>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-72 max-w-full" />
          <Skeleton className="h-4 w-48" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-6 w-24 rounded-full" />
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-11/12" />
            <Skeleton className="h-3.5 w-4/5" />
            <Skeleton className="h-3.5 w-2/3" />
          </div>
          <CardSkeleton rows={3} />
        </div>
        <div className="space-y-6">
          <div className="space-y-5 rounded-xl border border-slate-200 bg-white p-5">
            <Skeleton className="h-4 w-32" />
            {Array.from({ length: 5 }, (_, step) => (
              <div key={step} className="flex items-center gap-3">
                <Skeleton className="h-5 w-5 shrink-0 rounded-full" />
                <Skeleton className="h-3.5 w-28" />
              </div>
            ))}
          </div>
          <CardSkeleton rows={2} />
        </div>
      </div>
    </div>
  );
}

function FormSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Heading titleWidth="w-64" />
      <div className="space-y-5 rounded-xl border border-slate-200 bg-white p-6">
        <FieldSkeleton />
        <FieldSkeleton />
        <FieldSkeleton />
        <FieldSkeleton />
        <div className="space-y-2">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-28 w-full rounded-lg" />
        </div>
        <div className="flex gap-3 pt-2">
          <Skeleton className="h-10 w-36 rounded-lg" />
          <Skeleton className="h-10 w-24 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

function AuthSkeleton() {
  return (
    <div className="flex justify-center py-8 sm:py-12">
      <div className="w-full max-w-md space-y-5 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="space-y-2 text-center">
          <Skeleton className="mx-auto h-6 w-40" />
          <Skeleton className="mx-auto h-3.5 w-56 max-w-full" />
        </div>
        <FieldSkeleton />
        <FieldSkeleton />
        <Skeleton className="h-10 w-full rounded-lg" />
        <Skeleton className="mx-auto h-3 w-40" />
      </div>
    </div>
  );
}

function ArticleSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Skeleton className="h-8 w-3/4" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-11/12" />
      <Skeleton className="h-4 w-4/5" />
      <Skeleton className="mt-8 h-6 w-1/2" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-10/12" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="mt-8 h-6 w-2/5" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-9/12" />
    </div>
  );
}

function LandingSkeleton() {
  return (
    <div className="space-y-12">
      <div className="grid items-center gap-10 py-6 lg:grid-cols-2 lg:py-12">
        <div className="space-y-4">
          <Skeleton className="h-6 w-44 rounded-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-4/5" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-2/3" />
          <div className="flex flex-wrap gap-3 pt-2">
            <Skeleton className="h-11 w-44 rounded-lg" />
            <Skeleton className="h-11 w-32 rounded-lg" />
          </div>
        </div>
        <Skeleton className="aspect-[4/3] w-full rounded-2xl" />
      </div>
      <div className="stagger grid gap-4 sm:grid-cols-3">
        <CardBlock />
        <CardBlock />
        <CardBlock />
      </div>
    </div>
  );
}

function CardBlock() {
  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
      <Skeleton className="h-10 w-10 rounded-lg" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-4/5" />
    </div>
  );
}

function DefaultSkeleton() {
  return (
    <div className="space-y-6">
      <Heading />
      <CardSkeleton rows={4} />
    </div>
  );
}
