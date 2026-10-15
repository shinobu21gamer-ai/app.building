import { Badge } from "@/components/ui/badge";
import { formatPeso } from "@/lib/cases/manpower";
import { formatDateTime } from "@/lib/format";
import { copy, type Locale } from "@/lib/i18n";
import { AGING_BUCKETS } from "@/lib/treasury/ledger";
import type { TreasuryDashboard } from "@/lib/treasury/query";

const ENTRY_TONES: Record<
  string,
  "sky" | "amber" | "green" | "violet" | "gray" | "red"
> = {
  APPROPRIATION: "sky",
  ALLOCATION_ADJUSTMENT: "violet",
  EARMARK_RESERVE: "amber",
  EARMARK_RELEASE: "green",
  EARMARK_CANCEL: "green",
  DISBURSEMENT_RESERVE: "amber",
  DISBURSEMENT_RELEASE: "red",
  DISBURSEMENT_CANCEL: "green",
  LIQUIDATION: "gray",
};

type LedgerRowView = {
  id: number;
  entryType: string;
  entryLabel: string;
  amount: number;
  reservedAfter?: number;
  disbursedAfter?: number;
  availableAfter: number;
  memo: string | null;
  createdAt: Date | string;
  coaCode?: string;
  actorName: string | null;
};

/**
 * The ledger table. Entries are append-only, so a correction shows up as a new
 * row with its own memo — that is the point, and the table says so.
 */
export function LedgerTable({
  entries,
  locale = "en",
  showAllocation = false,
}: {
  entries: LedgerRowView[];
  locale?: Locale;
  showAllocation?: boolean;
}) {
  const t = copy[locale].revamp.treasuryDesk;

  if (entries.length === 0) {
    return <p className="text-sm text-ink-subtle">{t.noEntries}</p>;
  }

  return (
    <div className="-mx-5 overflow-x-auto px-5">
      <table className="w-full min-w-[52rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-subtle">
            <th className="py-2 pr-3 font-medium">{t.ledgerEntry}</th>
            <th className="py-2 pr-3 font-medium">{t.ledgerWhen}</th>
            {showAllocation && (
              <th className="py-2 pr-3 font-medium">{t.coaAccount}</th>
            )}
            <th className="py-2 pr-3 font-medium">{t.ledgerMemo}</th>
            <th className="py-2 pr-3 text-right font-medium">{t.ledgerAmount}</th>
            <th className="py-2 pr-3 text-right font-medium">
              {t.ledgerReservedAfter}
            </th>
            <th className="py-2 pr-3 text-right font-medium">
              {t.ledgerDisbursedAfter}
            </th>
            <th className="py-2 pr-3 text-right font-medium">
              {t.ledgerAvailableAfter}
            </th>
            <th className="py-2 pr-3 font-medium">{t.ledgerActor}</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const paidOut = entry.entryType === "DISBURSEMENT_RELEASE";
            return (
              <tr
                key={entry.id}
                className={
                  paidOut
                    ? "border-b border-line bg-red-50/70"
                    : "border-b border-line"
                }
              >
                <td className="py-2 pr-3">
                  <Badge tone={ENTRY_TONES[entry.entryType] ?? "neutral"}>
                    {entry.entryLabel}
                  </Badge>
                  {paidOut ? (
                    <p className="mt-1 text-xs font-semibold text-red-800">
                      {t.ledgerPaidOut}
                    </p>
                  ) : null}
                </td>
                <td className="py-2 pr-3 whitespace-nowrap text-ink">
                  {formatDateTime(entry.createdAt)}
                </td>
                {showAllocation && (
                  <td className="py-2 pr-3 font-mono text-xs text-ink-muted">
                    {entry.coaCode ?? "—"}
                  </td>
                )}
                <td className="py-2 pr-3 text-ink-muted">{entry.memo ?? "—"}</td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {formatPeso(entry.amount)}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-ink-muted">
                  {entry.reservedAfter === undefined
                    ? "—"
                    : formatPeso(entry.reservedAfter)}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-ink-muted">
                  {entry.disbursedAfter === undefined
                    ? "—"
                    : formatPeso(entry.disbursedAfter)}
                </td>
                <td className="py-2 pr-3 text-right font-semibold tabular-nums text-ink">
                  {formatPeso(entry.availableAfter)}
                </td>
                <td className="py-2 pr-3 font-medium text-ink">
                  {entry.actorName ?? "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Compact aging bars for the dashboard: how long vouchers have been waiting. */
export function AgingBars({
  aging,
  locale = "en",
}: {
  aging: TreasuryDashboard["aging"];
  locale?: Locale;
}) {
  const t = copy[locale].revamp.treasuryDesk;
  const buckets = AGING_BUCKETS.map((bucket) => ({
    bucket,
    ...aging[bucket],
  }));
  const largest = Math.max(1, ...buckets.map((entry) => entry.count));

  return (
    <ul className="space-y-2">
      {buckets.map((entry) => (
        <li key={entry.bucket} className="space-y-1">
          <div className="flex items-center justify-between text-xs text-ink-muted">
            <span>{t.agingBucket.replace("{bucket}", entry.bucket)}</span>
            <span>
              {t.agingCount
                .replace("{count}", String(entry.count))
                .replace("{amount}", entry.amount.toLocaleString("en-PH"))}
            </span>
          </div>
          <div className="h-2 rounded-full bg-surface-sunken">
            <div
              className="h-2 rounded-full bg-amber-500"
              style={{ width: `${(entry.count / largest) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
