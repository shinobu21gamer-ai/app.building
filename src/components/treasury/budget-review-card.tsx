"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  FormMessage,
  Label,
  Textarea,
} from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { apiRequest } from "@/lib/api-client";
import { formatPeso } from "@/lib/cases/manpower";
import { copy, type Locale } from "@/lib/i18n";
import { formatDate } from "@/lib/format";
import {
  amountFitDelta,
  classifyAmountFit,
} from "@/lib/treasury/funding-guide";

export type BudgetReviewRecommended = {
  allocationId: number;
  /** Short name of the budget line, for the confirmation copy. */
  label: string;
  coaName: string;
  fiscalYear: number;
  /** Live available balance on the line. */
  available: number;
};

export type BudgetReviewNotFunded = {
  reason: string;
  decidedByName: string | null;
  decidedAt: string;
};

/**
 * The treasurer's decision on one case: set the money aside (one amount box,
 * the recommended budget line already chosen) or say no with a reason. No
 * dropdowns — the card arrives with its own numbers, and the two buttons are
 * the whole conversation. A "do not fund" decision is recorded on the case so
 * the officials see the answer and its reason instead of waiting silently.
 */
export function BudgetReviewCard({
  concernId,
  caseNumber,
  title,
  uncommitted,
  recommended,
  notFunded = null,
  locale = "en",
}: {
  concernId: number;
  caseNumber: string;
  title: string;
  /** What a new proposal still has to cover (the box starts here). */
  uncommitted: number;
  /** The one recommended budget line; null when there is no budget at all. */
  recommended: BudgetReviewRecommended | null;
  /** The current "do not fund" decision, if any. */
  notFunded?: BudgetReviewNotFunded | null;
  locale?: Locale;
}) {
  const t = copy[locale].revamp.treasuryDesk.fundCase;
  const common = copy[locale].revamp.common;
  const router = useRouter();
  const [amount, setAmount] = useState(String(uncommitted));
  const [busy, setBusy] = useState<"setAside" | "doNotFund" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proposed, setProposed] = useState<{
    code: string | null;
    amount: number;
  } | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [reason, setReason] = useState("");

  const requested = Number(amount);
  const validAmount = Number.isFinite(requested) && requested > 0;
  const fit = classifyAmountFit(requested, uncommitted);
  const gap = amountFitDelta(requested, uncommitted);
  const fitMessage =
    fit === "exact"
      ? t.amountFitExact
      : fit === "partial"
        ? t.amountFitPartial.replaceAll("{short}", formatPeso(gap))
        : fit === "over"
          ? t.amountFitOver.replaceAll("{extra}", formatPeso(gap))
          : t.amountFitEmpty.replaceAll("{amount}", formatPeso(uncommitted));

  async function setAside() {
    if (!recommended || !validAmount) return;
    setBusy("setAside");
    setError(null);
    const response = await apiRequest<{
      earmarkId: number;
      code: string | null;
      amount: number;
    }>("/api/v1/treasury/earmarks", {
      method: "POST",
      body: JSON.stringify({
        allocationId: recommended.allocationId,
        concernId,
        purpose: `${caseNumber}: ${title}`.slice(0, 200),
        amount: requested,
      }),
    });
    setBusy(null);
    if (!response.success) {
      setError(response.error.message);
      return;
    }
    setProposed({ code: response.data.code, amount: response.data.amount });
    router.refresh();
  }

  async function doNotFund() {
    if (reason.trim().length < 10) {
      setError(t.doNotFundReasonRequired);
      return;
    }
    setBusy("doNotFund");
    setError(null);
    const response = await apiRequest<{ decision: string }>(
      `/api/v1/treasury/concerns/${concernId}/budget-decision`,
      {
        method: "POST",
        body: JSON.stringify({ reason: reason.trim() }),
      }
    );
    setBusy(null);
    if (!response.success) {
      setError(response.error.message);
      return;
    }
    setModalOpen(false);
    setReason("");
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {notFunded && (
        <div className="rounded-control border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <p className="font-semibold">{t.decisionNotFund}</p>
          <p className="mt-0.5">{notFunded.reason}</p>
          <p className="mt-1 text-xs">
            {t.decisionBy.replaceAll(
              "{name}",
              notFunded.decidedByName ?? "—"
            )}
            {" · "}
            {formatDate(new Date(notFunded.decidedAt))}
          </p>
        </div>
      )}

      {proposed ? (
        <FormMessage tone="success">
          {t.proposedOk
            .replaceAll(
              "{code}",
              proposed.code ?? `#${proposed.amount.toFixed(2)}`
            )
            .replaceAll("{amount}", formatPeso(proposed.amount))}
        </FormMessage>
      ) : (
        <div className="space-y-3">
        <div className="rounded-control border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          <p className="font-semibold">
            {t.needCallout.replaceAll("{amount}", formatPeso(uncommitted))}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-amber-900">
            {t.needExactHint.replaceAll("{amount}", formatPeso(uncommitted))}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-44 flex-1">
            <Label htmlFor={`fund-amount-${concernId}`}>
              {t.amountToSetAside}
            </Label>
            <input
              id={`fund-amount-${concernId}`}
              type="number"
              min={0}
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="h-10 w-full rounded-control border border-line-strong bg-surface px-3 text-sm text-ink focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30"
              aria-describedby={`fund-amount-fit-${concernId}`}
            />
            <p
              id={`fund-amount-fit-${concernId}`}
              className={
                fit === "exact"
                  ? "mt-1 text-xs text-emerald-800"
                  : fit === "partial" || fit === "empty"
                    ? "mt-1 text-xs text-amber-800"
                    : "mt-1 text-xs text-ink-muted"
              }
            >
              {fitMessage}
            </p>
          </div>
          <Button
            onClick={setAside}
            disabled={busy !== null || !validAmount || recommended === null}
            loading={busy === "setAside"}
          >
            {t.setAsideButton.replaceAll(
              "{amount}",
              formatPeso(validAmount ? requested : 0)
            )}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setError(null);
              setModalOpen(true);
            }}
            disabled={busy !== null}
          >
            {t.doNotFundButton}
          </Button>
        </div>
        </div>
      )}

      {recommended &&
        !proposed &&
        validAmount &&
        recommended.available + 0.005 < requested && (
        <p className="text-xs text-amber-700">
          {t.notCovers
            .replaceAll("{available}", formatPeso(recommended.available))
            .replaceAll("{need}", formatPeso(requested))}
        </p>
      )}

      {error && <FormMessage tone="error">{error}</FormMessage>}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={t.doNotFundTitle}
        description={t.doNotFundDesc.replaceAll("{case}", caseNumber)}
        closeLabel={common.close}
      >
        <div className="space-y-3">
          <div>
            <Label htmlFor={`fund-reason-${concernId}`}>
              {t.doNotFundReasonLabel}
            </Label>
            <Textarea
              id={`fund-reason-${concernId}`}
              rows={3}
              maxLength={1000}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={t.doNotFundReasonPlaceholder}
            />
            <p className="mt-1 text-xs text-ink-subtle">
              {t.doNotFundReasonHint}
            </p>
          </div>
          {error && <FormMessage tone="error">{error}</FormMessage>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setModalOpen(false)}>
              {common.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={doNotFund}
              loading={busy === "doNotFund"}
              disabled={reason.trim().length < 10}
            >
              {t.doNotFundConfirm}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
