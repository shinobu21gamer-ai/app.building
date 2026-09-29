import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format";

type HistoryEntry = {
  id: number;
  entryType: string;
  fromStatus: string | null;
  toStatus: string | null;
  remarks: string | null;
  actorRole: string | null;
  createdAt: Date;
};

export type ResolutionInfo = {
  summary: string;
  actionsTaken: string;
  resolutionType: string;
};

const ENTRY_LABEL: Record<string, string> = {
  STATUS_CHANGE: "Status change",
  ASSIGNMENT: "Assignment",
  RESOLUTION: "Concern resolved",
  CLOSE: "Case closed",
  REMARK: "Progress remark",
  ACTION: "Action taken",
  PRIORITY_OVERRIDE: "Priority override",
  SLA_BREACH: "Service deadline missed",
};

function describeEntry(entry: HistoryEntry): string {
  if (entry.entryType === "STATUS_CHANGE") {
    if (entry.fromStatus && entry.toStatus) {
      return `Status changed from ${entry.fromStatus} to ${entry.toStatus}`;
    }
    if (entry.toStatus) return `Status set to ${entry.toStatus}`;
  }
  return ENTRY_LABEL[entry.entryType] ?? "Update";
}

export function CaseTimeline({
  entries,
  resolution,
}: {
  entries: HistoryEntry[];
  resolution?: ResolutionInfo | null;
}) {
  if (entries.length === 0) {
    return <p className="text-sm text-slate-500">No activity recorded yet.</p>;
  }

  return (
    <ol className="space-y-5">
      {entries.map((entry) => (
        <li key={entry.id} className="relative border-l border-slate-200 pl-4">
          <span className="absolute top-1.5 -left-[5px] h-2.5 w-2.5 rounded-full bg-brand-600" />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-slate-900">
              {describeEntry(entry)}
            </span>
            {entry.actorRole && (
              <Badge tone="neutral">{entry.actorRole}</Badge>
            )}
          </div>
          {entry.remarks && (
            <p className="mt-1 text-sm text-slate-600">{entry.remarks}</p>
          )}
          {entry.entryType === "RESOLUTION" && resolution && (
            <div className="mt-2 space-y-1 rounded-md border border-emerald-100 bg-emerald-50 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-emerald-900">
                  {resolution.summary}
                </span>
                <Badge tone="green">{resolution.resolutionType}</Badge>
              </div>
              <p className="whitespace-pre-wrap text-emerald-800">
                {resolution.actionsTaken}
              </p>
            </div>
          )}
          <p className="mt-1 text-xs text-slate-400">
            {formatDateTime(entry.createdAt)}
          </p>
        </li>
      ))}
    </ol>
  );
}