import { CASE_STATUSES, type CaseStatus } from "@/lib/cases/workflow";
import { formatDateTime } from "@/lib/format";

const STATUS_INDEX: Record<CaseStatus, number> = {
  SUBMITTED: 0,
  ASSIGNED: 1,
  IN_PROGRESS: 2,
  RESOLVED: 3,
  CLOSED: 4,
};

type ReachedDates = Partial<Record<CaseStatus, Date | null>>;

/** A step is complete once the case has passed it or reached it with a date. */
function isReached(
  status: CaseStatus,
  current: string,
  reached: ReachedDates | undefined
): boolean {
  const currentIndex = STATUS_INDEX[current as CaseStatus] ?? 0;
  return (
    STATUS_INDEX[status] <= currentIndex || Boolean(reached?.[status])
  );
}

export function CaseStatusStepper({
  currentStatus,
  reached,
}: {
  currentStatus: string;
  reached?: ReachedDates;
}) {
  const currentIndex = STATUS_INDEX[currentStatus as CaseStatus] ?? 0;

  return (
    <ol className="space-y-0">
      {CASE_STATUSES.map((status, index) => {
        const done = isReached(status, currentStatus, reached);
        const isCurrent = status === currentStatus;
        const reachedDate = reached?.[status];
        return (
          <li key={status} className="relative flex gap-3 pb-6 last:pb-0">
            {index < CASE_STATUSES.length - 1 && (
              <span
                aria-hidden
                style={{ animationDelay: `${index * 120}ms` }}
                className={`absolute left-[9px] top-5 h-full w-0.5 ${
                  done ? "grow-y bg-brand-500" : "bg-slate-200"
                }`}
              />
            )}
            <span
              style={{ animationDelay: `${index * 120}ms` }}
              className={`relative z-10 mt-1 flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full border-2 ${
                done
                  ? "animate-scale-in border-brand-600 bg-brand-600 text-white"
                  : "border-slate-300 bg-white"
              } ${isCurrent ? "ring-4 ring-brand-100" : ""}`}
            >
              {isCurrent && (
                <span
                  aria-hidden="true"
                  className="absolute inset-0 animate-ping rounded-full bg-brand-400/60"
                  style={{ animationIterationCount: 3 }}
                />
              )}
              {done && (
                <svg
                  viewBox="0 0 12 12"
                  fill="currentColor"
                  className="h-3 w-3"
                  aria-hidden
                >
                  <path d="M9.75 2.25 4.5 8.25 2.25 5.85" />
                </svg>
              )}
            </span>
            <div className="flex flex-1 items-baseline justify-between gap-3 pb-1">
              <span
                className={`text-sm font-semibold ${
                  done ? "text-slate-900" : "text-slate-400"
                }`}
              >
                {status}
              </span>
              {reachedDate ? (
                <span className="text-xs tabular-nums text-slate-500">
                  {formatDateTime(reachedDate)}
                </span>
              ) : (
                <span className="text-xs text-slate-400">
                  {index > currentIndex ? "Pending" : "\u00a0"}
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}