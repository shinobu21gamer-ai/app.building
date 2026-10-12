import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { copy, type Locale } from "@/lib/i18n";
import { formatDateTime } from "@/lib/format";
import { escalationLevelLabel } from "@/lib/sla/policy";
import type { EscalationQueueRow } from "@/lib/sla/escalation";
import { EscalationActions } from "@/components/sla/escalation-actions";

const LEVEL_TONES: Record<number, "amber" | "orange" | "red"> = {
  1: "amber",
  2: "orange",
  3: "red",
};

function statusOf(row: EscalationQueueRow): "OPEN" | "ACKNOWLEDGED" | "RESOLVED" {
  if (row.resolvedAt) return "RESOLVED";
  if (row.acknowledgedAt) return "ACKNOWLEDGED";
  return "OPEN";
}

/**
 * The escalation queue: what is late, how late, who was told, and what the
 * reader can do about it. Rendered as cards on phones and a table from `md` up.
 */
export function EscalationTable({
  rows,
  locale,
  showCaseLink = false,
  showActions = true,
}: {
  rows: EscalationQueueRow[];
  locale: Locale;
  /** Only administrators may open the case page; the Captain portal has no case view. */
  showCaseLink?: boolean;
  showActions?: boolean;
}) {
  const t = copy[locale].revamp.slaDesk;

  if (rows.length === 0) {
    return (
      <p className="rounded-control border border-dashed border-line px-4 py-6 text-center text-sm text-ink-subtle">
        {t.queueEmpty}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {rows.map((row) => {
        const status = statusOf(row);
        return (
          <div
            key={row.id}
            className="rounded-card border border-line bg-surface p-4 shadow-card"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={LEVEL_TONES[row.level] ?? "red"}>
                    {escalationLevelLabel(row.level)}
                  </Badge>
                  <Badge tone={status === "OPEN" ? "red" : status === "ACKNOWLEDGED" ? "amber" : "green"}>
                    {status === "OPEN" ? t.statusOpen : status === "ACKNOWLEDGED" ? t.statusAcknowledged : t.resolved}
                  </Badge>
                  <span className="font-mono text-xs text-ink-subtle">{row.caseNumber}</span>
                </div>
                <p className="mt-1 truncate text-sm font-medium text-ink">
                  {showCaseLink ? (
                    <Link
                      className="hover:underline"
                      href={`/official/concerns/${row.concernId}`}
                    >
                      {row.caseTitle}
                    </Link>
                  ) : (
                    row.caseTitle
                  )}
                </p>
                <p className="mt-0.5 text-xs text-ink-subtle">
                  {t.stuckIn} {row.stage.replaceAll("_", " ").toLowerCase()} ·{" "}
                  {row.hoursOverdue}h {t.overdue} · {t.escalatedTo} {row.escalatedToRole}
                  {row.policyName ? ` · ${row.policyName}` : ""}
                  {row.assignedOfficeName ? ` · ${row.assignedOfficeName}` : ""}
                </p>
                <p className="mt-0.5 text-xs text-ink-faint">
                  {t.raised} {formatDateTime(row.createdAt)}
                  {row.acknowledgedAt
                    ? ` · ${t.acknowledgedBy} ${row.acknowledgedByName ?? ""} ${formatDateTime(row.acknowledgedAt)}`
                    : ""}
                </p>
              </div>

              {showActions ? (
                <EscalationActions id={row.id} locale={locale} status={status} />
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
