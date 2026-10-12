"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { apiRequest } from "@/lib/api-client";
import { copy, type Locale } from "@/lib/i18n";

/**
 * The retention desk: what each policy keeps, when it last ran, and a button to
 * run it again.
 *
 * The buttons call the same server routine the cron job calls, so a manual run
 * and a scheduled run are indistinguishable in the run records — which is the
 * point: "who ran this, and what did it delete" has one answer either way.
 */

export type RetentionDeskRow = {
  key: string;
  dataCategory: string;
  action: string;
  retentionDays: number;
  lastRunAt: string | null;
  status: string;
  scanned: number;
  affected: number;
  due: boolean;
};

type RunResult = {
  totals: { scanned: number; affected: number; failed: number; policies: number };
};

export function RetentionDesk({
  locale,
  rows,
  lastSweepAt,
}: {
  locale: Locale;
  rows: RetentionDeskRow[];
  lastSweepAt: string | null;
}) {
  const t = copy[locale].revamp.adminDesk;
  const [running, setRunning] = useState<string | null>(null);
  const router = useRouter();
  const { showToast } = useToast();

  async function run(policy?: string) {
    setRunning(policy ?? "ALL");
    const result = await apiRequest<RunResult>("/api/v1/admin/privacy/retention", {
      method: "POST",
      body: JSON.stringify(policy ? { policy } : {}),
    });
    setRunning(null);

    if (!result.success) {
      showToast(
        "error",
        t.retentionRunFailed.replace("{message}", result.error.message)
      );
      return;
    }

    showToast(
      "success",
      t.retentionRunDone
        .replace("{scanned}", result.data.totals.scanned.toLocaleString("en-PH"))
        .replace("{affected}", result.data.totals.affected.toLocaleString("en-PH"))
    );
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">
          {t.retentionLastRunCol}:{" "}
          {lastSweepAt
            ? new Date(lastSweepAt).toISOString().slice(0, 16).replace("T", " ")
            : t.retentionNever}
        </p>
        <Button
          type="button"
          size="sm"
          disabled={running !== null}
          onClick={() => void run()}
        >
          {running === "ALL" ? t.retentionRunning : t.retentionRunAll}
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table data-stack className="w-full min-w-[720px] text-left text-sm">
          <caption className="sr-only">{t.retentionTitle}</caption>
          <thead>
            <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-subtle">
              <th scope="col" className="py-2 pr-3 font-semibold">
                {t.retentionPolicyCol}
              </th>
              <th scope="col" className="py-2 pr-3 font-semibold">
                {t.retentionCategoryCol}
              </th>
              <th scope="col" className="py-2 pr-3 font-semibold">
                {t.retentionActionCol}
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold">
                {t.retentionDaysCol}
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold">
                {t.retentionScanCol}
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold">
                {t.retentionAffectedCol}
              </th>
              <th scope="col" className="py-2 pr-3 font-semibold">
                {t.retentionStatusCol}
              </th>
              <th scope="col" className="py-2 font-semibold">
                <span className="sr-only">{t.retentionRunOne}</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <tr key={row.key}>
                <td data-label={t.retentionPolicyCol} className="py-2 pr-3 font-mono text-xs text-ink">
                  <span className="block">{row.key}</span>
                  <span className="block text-[11px] text-ink-subtle">
                    {row.lastRunAt
                      ? `${t.retentionLastRunCol}: ${row.lastRunAt.slice(0, 10)}`
                      : t.retentionNever}
                  </span>
                </td>
                <td data-label={t.retentionCategoryCol} className="py-2 pr-3 text-ink-muted">
                  {row.dataCategory}
                </td>
                <td data-label={t.retentionActionCol} className="py-2 pr-3 text-ink-muted">
                  {row.action}
                </td>
                <td data-label={t.retentionDaysCol} className="py-2 pr-3 text-right tabular-nums text-ink">
                  {row.retentionDays}
                </td>
                <td data-label={t.retentionScanCol} className="py-2 pr-3 text-right tabular-nums text-ink">
                  {row.scanned}
                </td>
                <td data-label={t.retentionAffectedCol} className="py-2 pr-3 text-right tabular-nums text-ink">
                  {row.affected}
                </td>
                <td data-label={t.retentionStatusCol} className="py-2 pr-3 text-xs">
                  <span className="text-ink-muted">{row.status}</span>
                  <span className="ml-2 text-ink-subtle">
                    {row.due ? t.retentionDueNow : t.retentionWaiting}
                  </span>
                </td>
                <td className="py-2 text-right">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={running !== null}
                    onClick={() => void run(row.key)}
                  >
                    {running === row.key ? t.retentionRunning : t.retentionRunShort}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
