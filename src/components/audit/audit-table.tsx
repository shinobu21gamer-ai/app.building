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
      <p className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
        {t.entriesEmpty}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[52rem] text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-slate-500">
          <tr className="border-b border-slate-200">
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
            <tr key={row.id} className="border-b border-slate-100 align-top">
              <td className="px-2 py-2 font-mono text-xs text-slate-500">
                {row.seq === null ? (
                  <Badge tone="amber">{t.unchained}</Badge>
                ) : (
                  row.seq.toString()
                )}
              </td>
              <td className="px-2 py-2 whitespace-nowrap text-xs text-slate-500">
                {formatDateTime(row.createdAt)}
              </td>
              <td className="px-2 py-2">
                <span className="font-medium text-slate-900">{row.action}</span>
                {row.description ? (
                  <p className="mt-0.5 max-w-md text-xs text-slate-500">{row.description}</p>
                ) : null}
              </td>
              <td className="px-2 py-2 text-xs text-slate-600">
                {row.resourceType}
                {row.resourceId ? ` #${row.resourceId}` : ""}
              </td>
              <td className="px-2 py-2 text-xs text-slate-600">
                {row.user
                  ? `${row.user.firstName} ${row.user.lastName}`.trim()
                  : row.actorRole ?? "—"}
                <p className="text-[11px] text-slate-400">{row.actorRole ?? ""}</p>
              </td>
              <td className="px-2 py-2 font-mono text-[11px] text-slate-500">
                {shortHash(row.hash)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
