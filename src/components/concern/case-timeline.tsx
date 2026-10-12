import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { sortJournal, type JournalEntryDates } from "@/lib/cases/journal";
import { formatDate, formatDateTime } from "@/lib/format";
import { copy, type Copy, type Locale } from "@/lib/i18n";

type HistoryEntry = {
  id: number;
  entryType: string;
  fromStatus: string | null;
  toStatus: string | null;
  remarks: string | null;
  actorRole: string | null;
  createdAt: Date;
  /** The day the recorded action happened, when the entry has one. */
  occurredOn: Date | null;
  /** Proof photo attached to a status change. */
  attachmentUrl: string | null;
};

export type ResolutionInfo = {
  summary: string;
  actionsTaken: string;
  resolutionType: string;
};

/** The short label for a journal entry, e.g. "Status changed: IN PROGRESS → CLOSED". */
export type JournalEntryLike = {
  entryType?: string | null;
  fromStatus?: string | null;
  toStatus?: string | null;
};

export function describeJournalEntry(
  // Print views sort rows whose entry fields are not part of the dating type,
  // so the label helper accepts either shape and reads the fields it needs.
  entry: JournalEntryLike | JournalEntryDates,
  t: Copy["desk"]
): string {
  const row = entry as JournalEntryLike;
  if (row.entryType === "STATUS_CHANGE") {
    if (row.fromStatus && row.toStatus) {
      return t.entryStatusChange
        .replace("{from}", row.fromStatus)
        .replace("{to}", row.toStatus);
    }
    if (row.toStatus) {
      return t.entryStatusSet.replace("{status}", row.toStatus);
    }
    return t.entryStatus;
  }
  const labels: Record<string, string> = {
    ASSIGNMENT: t.entryAssignment,
    RESOLUTION: t.entryResolution,
    CLOSE: t.entryClose,
    REMARK: t.entryRemark,
    ACTION: t.entryAction,
    PRIORITY_OVERRIDE: t.entryOverride,
    SLA_BREACH: t.entrySla,
    // Stage-3 workflow entries.
    ASSESSMENT: t.entryAssessment,
    MANPOWER_PLAN: t.entryManpower,
    CREW_ASSIGNMENT: t.entryCrew,
    CREW_PROGRESS: t.entryCrewProgress,
    OVERRIDE: t.entryWorkflowOverride,
    VERIFICATION: t.entryVerification,
    BUDGET: t.entryBudget,
  };
  return (row.entryType && labels[row.entryType]) || t.entryUpdate;
}

/**
 * The case journal. Entries are shown in the order of the day they are dated
 * to, so a backdated action sits where it happened. Each entry also shows when
 * it was recorded, which never changes.
 */
export function CaseTimeline({
  entries,
  resolution,
  locale = "en",
}: {
  entries: HistoryEntry[];
  resolution?: ResolutionInfo | null;
  locale?: Locale;
}) {
  const t = copy[locale].desk;

  if (entries.length === 0) {
    return <p className="text-sm text-slate-500">{t.noActivity}</p>;
  }

  return (
    <ol className="space-y-5">
      {sortJournal(entries).map((entry) => (
        <li key={entry.id} className="relative border-l border-slate-200 pl-4">
          <span className="absolute top-1.5 -left-[5px] h-2.5 w-2.5 rounded-full bg-brand-600" />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-slate-900">
              {describeJournalEntry(entry, t)}
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
                <Badge tone="green">
                  {t.types[resolution.resolutionType as keyof typeof t.types] ??
                    resolution.resolutionType}
                </Badge>
              </div>
              <p className="whitespace-pre-wrap text-emerald-800">
                {resolution.actionsTaken}
              </p>
            </div>
          )}
          {entry.attachmentUrl && (
            <figure className="mt-2">
              <Image
                src={entry.attachmentUrl}
                alt={t.proofAlt}
                width={800}
                height={600}
                unoptimized
                className="h-auto w-full max-w-xs rounded-lg border border-slate-200"
              />
              <figcaption className="mt-1 text-xs text-slate-500">
                {t.proofPhotoCaption}
              </figcaption>
            </figure>
          )}
          <p className="mt-1 text-xs text-slate-400">
            {entry.occurredOn
              ? t.actionDateLine
                  .replace("{date}", formatDate(entry.occurredOn))
                  .replace("{recorded}", formatDateTime(entry.createdAt))
              : formatDateTime(entry.createdAt)}
          </p>
        </li>
      ))}
    </ol>
  );
}
