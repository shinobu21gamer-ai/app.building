import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format";
import { copy, type Locale } from "@/lib/i18n";
import type { AuditEntryRow } from "@/lib/audit/store";

/** First 12 hex characters of a hash — enough to recognise, short enough to read. */
function shortHash(hash: string | null): string {
  if (!hash) return "—";
  return `${hash.slice(0, 12)}…`;
}

/**
 * The audit trail as a table. `seq` and `hash` are shown for every row: the
 * point of the chain is that a reader can point at a row and at the hash the
 * next row links to.
 */
export function AuditTable({
  rows,
  locale,
}: {
  rows: AuditEntryRow[];
  locale: Locale;
}) {
  const t = copy[locale].revamp.auditDesk;

  if (rows.length === 0) {
    return (
      <p className="rounded-control border border-dashed border-line px-4 py-6 text-center text-sm text-ink-subtle">
        {t.entriesEmpty}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[52rem] text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-ink-subtle">
          <tr className="border-b border-line">
            <th className="px-2 py-2">{t.colSeq}</th>
            <th className="px-2 py-2">{t.colWhen}</th>
            <th className="px-2 py-2">{t.colAction}</th>
            <th className="px-2 py-2">{t.colResource}</th>
            <th className="px-2 py-2">{t.colActor}</th>
            <th className="px-2 py-2">{t.colHash}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-line align-top">
              <td className="px-2 py-2 font-mono text-xs text-ink-subtle">
                {row.seq === null ? (
                  <Badge tone="amber">{t.unchained}</Badge>
                ) : (
                  row.seq.toString()
                )}
              </td>
              <td className="px-2 py-2 whitespace-nowrap text-xs text-ink-subtle">
                {formatDateTime(row.createdAt)}
              </td>
              <td className="px-2 py-2">
                <span className="font-medium text-ink">{row.action}</span>
                {row.description ? (
                  <p className="mt-0.5 max-w-md text-xs text-ink-subtle">{row.description}</p>
                ) : null}
              </td>
              <td className="px-2 py-2 text-xs text-ink-muted">
                {row.resourceType}
                {row.resourceId ? ` #${row.resourceId}` : ""}
              </td>
              <td className="px-2 py-2 text-xs text-ink-muted">
                {row.user
                  ? `${row.user.firstName} ${row.user.lastName}`.trim()
                  : row.actorRole ?? "—"}
                <p className="text-[11px] text-slate-400">{row.actorRole ?? ""}</p>
              </td>
              <td className="px-2 py-2 font-mono text-[11px] text-ink-subtle">
                {shortHash(row.hash)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
