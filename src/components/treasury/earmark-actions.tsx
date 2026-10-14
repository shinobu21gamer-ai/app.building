"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  FormMessage,
  Label,
  RequiredLegend,
  Textarea,
} from "@/components/ui/field";
import { apiRequest } from "@/lib/api-client";
import { formatPeso } from "@/lib/cases/manpower";
import { copy, type Locale } from "@/lib/i18n";
import type { EarmarkApprovalBrief } from "@/lib/treasury/approval";

/**
 * Approving an earmark is what actually reserves the money; cancelling gives
 * the reservation back. Cancelling always carries a reason.
 *
 * The buttons are driven by the approval brief rather than by the permission
 * flag alone. That matters because two of the ways an approval fails are known
 * before the click, and used to be discovered only as a red error afterwards:
 *
 *   * segregation of duties — the preparer may not approve. An administrator
 *     holds both permissions, so they saw an "Approve earmark" button on their
 *     own proposal that could only ever fail. The earmark stayed PROPOSED, the
 *     case stayed in AWAITING_BUDGET, and the screen gave no way out. Now the
 *     button is not offered and the panel says who does decide;
 *   * the allocation cannot cover the amount — the ledger check would reject it.
 *
 * The confirmation step restates what is about to happen in money and in case
 * terms, so the last click is still an informed one.
 */
export function EarmarkActions({
  earmarkId,
  status,
  brief,
  allocationLabel,
  caseNumber,
  canCancel,
  locale = "en",
}: {
  earmarkId: number;
  status: string;
  /** The approval brief for this row, as seen by the current reader. */
  brief: EarmarkApprovalBrief;
  /** Named in the confirmation sentence: which budget the money leaves. */
  allocationLabel: string;
  /** Named in the confirmation sentence: which concern the money is for. */
  caseNumber: string | null;
  canCancel: boolean;
  locale?: Locale;
}) {
  const desk = copy[locale].revamp.treasuryDesk;
  const t = desk.earmarkReview;
  const common = copy[locale].revamp.common;
  const router = useRouter();
  const [mode, setMode] = useState<"APPROVE" | "CANCEL" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (
    (status !== "PROPOSED" && status !== "APPROVED") ||
    (!brief.canDecide && !canCancel)
  ) {
    return null;
  }

  async function run(action: "APPROVE" | "CANCEL", formData: FormData) {
    setBusy(true);
    setError(null);

    const reason = String(formData.get("reason") ?? "");
    const notes = String(formData.get("notes") ?? "");

    const result = await apiRequest<{ available: number }>(
      `/api/v1/treasury/earmarks/${earmarkId}`,
      {
        method: "PATCH",
        body: JSON.stringify(
          action === "APPROVE"
            ? { action, notes: notes === "" ? null : notes }
            : { action, reason }
        ),
      }
    );

    setBusy(false);
    if (!result.success) {
      setError(result.error.message);
      return;
    }
    setMode(null);
    router.refresh();
  }

  // "Reserve ₱12,000.00 from MOOE 2026 for BR-20260918-0001. ₱38,000.00 will be
  // left available." — the whole decision in one sentence at the last moment.
  const confirmation = t.confirmApprove
    .replaceAll("{amount}", formatPeso(brief.amount))
    .replaceAll("{allocation}", allocationLabel)
    .replaceAll(
      "{caseSuffix}",
      caseNumber === null ? "" : t.caseSuffix.replaceAll("{case}", caseNumber)
    )
    .replaceAll(
      "{available}",
      brief.balanceKnown ? formatPeso(brief.availableAfter) : t.balanceUnknown
    );

  // A block the reader cannot clear themselves still has to be explained; it is
  // just explained instead of being offered as a button that can only fail.
  const blockReason = status === "PROPOSED" ? brief.blockReason : null;
  const blockingNotice =
    blockReason === "SELF_PREPARED" || blockReason === "OVER_AVAILABLE"
      ? t.blocks[blockReason]
          .replaceAll("{desk}", t.approverDesk)
          .replaceAll("{amount}", formatPeso(brief.amount))
          .replaceAll(
            "{available}",
            brief.availableBefore === null
              ? t.balanceUnknown
              : formatPeso(brief.availableBefore)
          )
      : null;
  // Quieter: the reader has no approval right at all, so the only thing worth
  // saying is whose desk this is now sitting on.
  const waitingNotice =
    blockReason === "NO_PERMISSION" ? desk.earmarkWaitingOnCaptain : null;

  return (
    <div className="space-y-2">
      {error && <FormMessage tone="error">{error}</FormMessage>}

      {mode === null && (
        <>
          {blockingNotice && (
            <p className="rounded-control border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {blockingNotice}
            </p>
          )}
          {waitingNotice && (
            <p className="text-xs text-ink-subtle">{waitingNotice}</p>
          )}
          {(brief.canDecide || canCancel) && (
            <div className="flex flex-wrap gap-2">
              {brief.canDecide && (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setMode("APPROVE")}
                >
                  {desk.approveEarmark}
                </Button>
              )}
              {canCancel && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setMode("CANCEL")}
                >
                  {desk.cancelEarmark}
                </Button>
              )}
            </div>
          )}
        </>
      )}

      {mode !== null && (
        <form action={(formData) => run(mode, formData)} className="space-y-3">
          <RequiredLegend>{desk.requiredLegend}</RequiredLegend>
          {mode === "APPROVE" && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-ink">{confirmation}</p>
              <p className="text-sm text-ink-muted">{desk.earmarkApproved}</p>
              {brief.verdict === "PART_FUNDS" && (
                <p className="rounded-control border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  {t.verdicts.PART_FUNDS.replaceAll(
                    "{case}",
                    caseNumber ?? ""
                  ).replaceAll(
                    "{shortfall}",
                    formatPeso(brief.shortfallAfter)
                  )}
                </p>
              )}
              {brief.verdict === "OVER_FUNDS" && (
                <p className="rounded-control border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  {t.verdicts.OVER_FUNDS.replaceAll(
                    "{case}",
                    caseNumber ?? ""
                  ).replaceAll(
                    "{excess}",
                    formatPeso(brief.excessOverEstimate)
                  )}
                </p>
              )}
            </div>
          )}
          {mode === "CANCEL" && (
            <div>
              <Label htmlFor={`earmark-reason-${earmarkId}`} required>
                {desk.cancelReason}
              </Label>
              <Textarea
                id={`earmark-reason-${earmarkId}`}
                name="reason"
                rows={2}
                minLength={5}
                maxLength={500}
                required
              />
            </div>
          )}
          {mode === "APPROVE" && (
            <div>
              <Label htmlFor={`earmark-notes-${earmarkId}`}>
                {desk.verificationNotes}
              </Label>
              <Textarea
                id={`earmark-notes-${earmarkId}`}
                name="notes"
                rows={2}
                maxLength={500}
              />
            </div>
          )}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? common.saving : common.save}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setMode(null)}
              disabled={busy}
            >
              {common.cancel}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
