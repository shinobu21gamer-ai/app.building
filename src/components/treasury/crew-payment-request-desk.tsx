"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormMessage, Input, Label, Textarea } from "@/components/ui/field";
import { apiRequest } from "@/lib/api-client";
import { formatPeso } from "@/lib/cases/manpower";
import { formatDateTime } from "@/lib/format";
import { copy, type Locale } from "@/lib/i18n";

const selectStyles =
  "h-10 w-full rounded-control border border-line-strong bg-surface px-3 text-sm text-ink focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30";

export type CrewPaymentRequestEarmark = {
  id: number;
  code: string | null;
  purpose: string;
  amount: number;
  committed: number;
  concernId: number | null;
  allocationId: number;
};

export type CrewPaymentRequestView = {
  id: number;
  concernId: number;
  caseNumber: string;
  caseTitle: string;
  createdAt: string;
  status: string;
  lines: Array<{
    id: number;
    crewId: number;
    crewName: string;
    status: string;
    holdReason: string | null;
    voucherNumber: string | null;
    voucherStatus: string | null;
  }>;
};

type Decision = "PAY" | "HOLD";

export function CrewPaymentRequestDesk({
  requests,
  earmarks,
  locale = "en",
}: {
  requests: CrewPaymentRequestView[];
  earmarks: CrewPaymentRequestEarmark[];
  locale?: Locale;
}) {
  const t = copy[locale].revamp.treasuryDesk;
  const router = useRouter();
  const [decisions, setDecisions] = useState<Record<number, Decision>>({});
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const [earmarkIds, setEarmarkIds] = useState<Record<number, number | "">>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (requests.length === 0) {
    return (
      <section id="crew-payment-requests" className="rounded-card border border-line bg-surface p-4 sm:p-5">
        <h2 className="text-base font-semibold text-ink">{t.crewRequestsTitle}</h2>
        <p className="mt-1 text-sm text-ink-subtle">{t.crewRequestsEmpty}</p>
      </section>
    );
  }

  async function submit(request: CrewPaymentRequestView) {
    setError(null);
    setSuccess(null);
    const actionable = request.lines.filter((line) =>
      line.status !== "VOUCHER_PREPARED" ||
      line.voucherStatus === "REJECTED" ||
      line.voucherStatus === "CANCELLED"
    );
    const selected = actionable.filter((line) => decisions[line.id]);
    if (selected.length === 0) {
      setError(t.crewRequestChooseDecision);
      return;
    }

    const payLines = selected.filter((line) => decisions[line.id] === "PAY");
    const holdLines = selected.filter((line) => decisions[line.id] === "HOLD");
    const selectedEarmarkId = earmarkIds[request.id];
    if (payLines.length > 0 && selectedEarmarkId === undefined) {
      setError(t.crewRequestEarmarkChoose);
      return;
    }
    const selectedEarmark = earmarks.find((earmark) => earmark.id === selectedEarmarkId);
    const total = payLines.reduce((sum, line) => sum + Number(amounts[line.id] ?? 0), 0);
    if (payLines.some((line) => !Number.isFinite(Number(amounts[line.id])) || Number(amounts[line.id]) <= 0)) {
      setError(t.crewRequestEnterAmounts);
      return;
    }
    if (holdLines.some((line) => (reasons[line.id] ?? "").trim().length < 5)) {
      setError(t.crewRequestEnterHoldReason);
      return;
    }
    if (payLines.length > 0 && !selectedEarmark) {
      setError(t.crewRequestEarmarkChoose);
      return;
    }
    if (selectedEarmark && total > Math.max(0, selectedEarmark.amount - selectedEarmark.committed) + 0.005) {
      setError(
        t.crewRequestOverEarmark
          .replace("{total}", formatPeso(total))
          .replace("{available}", formatPeso(Math.max(0, selectedEarmark.amount - selectedEarmark.committed)))
      );
      return;
    }

    setBusy(request.id);
    const result = await apiRequest(`/api/v1/treasury/crew-payment-requests/${request.id}`, {
      method: "POST",
      body: JSON.stringify({
        earmarkId: payLines.length > 0 ? selectedEarmarkId : null,
        decisions: selected.map((line) =>
          decisions[line.id] === "PAY"
            ? { lineId: line.id, action: "PAY", amount: Number(amounts[line.id]) }
            : { lineId: line.id, action: "HOLD", reason: reasons[line.id] }
        ),
      }),
    });
    setBusy(null);
    if (!result.success) {
      setError(result.error.message || t.crewRequestSaveFailed);
      return;
    }
    setSuccess(t.crewRequestSaved);
    setDecisions((current) => {
      const next = { ...current };
      for (const line of selected) delete next[line.id];
      return next;
    });
    router.refresh();
  }

  return (
    <section id="crew-payment-requests" className="space-y-4 rounded-card border border-line bg-surface p-4 sm:p-5">
      <div>
        <h2 className="text-base font-semibold text-ink">{t.crewRequestsTitle}</h2>
        <p className="mt-1 text-sm text-ink-muted">{t.crewRequestsLead}</p>
      </div>
      {error && <FormMessage tone="error">{error}</FormMessage>}
      {success && <FormMessage tone="success">{success}</FormMessage>}
      <ul className="space-y-4">
        {requests.map((request) => {
          const availableEarmarks = earmarks.filter(
            (earmark) =>
              (earmark.concernId === request.concernId || earmark.concernId === null) &&
              earmark.amount > earmark.committed
          );
          const selectedEarmarkId = earmarkIds[request.id] ?? "";
          const selectedEarmark = availableEarmarks.find((earmark) => earmark.id === selectedEarmarkId);
          const selectedPayLines = request.lines.filter(
            (line) => decisions[line.id] === "PAY"
          );
          const total = selectedPayLines.reduce((sum, line) => sum + Number(amounts[line.id] ?? 0), 0);
          return (
            <li
              id={`crew-request-case-${request.concernId}`}
              key={request.id}
              className="space-y-4 rounded-control border border-line p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold text-ink">{request.caseNumber} · {request.caseTitle}</p>
                  <p className="text-xs text-ink-subtle">{formatDateTime(request.createdAt)}</p>
                </div>
                <Badge tone="amber">{t.crewRequestPending}</Badge>
              </div>
              <ol className="space-y-3">
                {request.lines.map((line) => {
                  const retryable = line.voucherStatus === "REJECTED" || line.voucherStatus === "CANCELLED";
                  const ready = line.status === "VOUCHER_PREPARED" && !retryable;
                  return (
                    <li key={line.id} className="grid gap-3 rounded-control bg-surface-sunken p-3 sm:grid-cols-[minmax(10rem,1fr)_minmax(14rem,1.4fr)]">
                      <div className="space-y-1">
                        <p className="font-medium text-ink">{line.crewName}</p>
                        {ready ? (
                          <p className="text-xs text-ink-subtle">
                            <Badge tone={line.voucherStatus === "RELEASED" || line.voucherStatus === "LIQUIDATED" ? "green" : "blue"}>
                              {line.voucherStatus === "DRAFT" ? t.crewRequestVoucherPrepared : line.voucherStatus}
                            </Badge>{" "}
                            {line.voucherNumber ?? ""} · {line.voucherStatus}
                          </p>
                        ) : line.status === "HELD" ? (
                          <p className="text-xs text-amber-800">{t.crewRequestHeld}: {line.holdReason}</p>
                        ) : null}
                        {retryable && (
                          <p className="text-xs text-amber-800">
                            {line.voucherNumber} · {line.voucherStatus} — {t.crewRequestRetry}
                          </p>
                        )}
                      </div>
                      {ready ? null : (
                        <fieldset className="space-y-3">
                          <legend className="sr-only">{line.crewName}</legend>
                          <div className="flex flex-wrap gap-4 text-sm">
                            <label className="flex items-center gap-2">
                              <input
                                type="radio"
                                name={`decision-${line.id}`}
                                checked={decisions[line.id] === "PAY"}
                                onChange={() => setDecisions((current) => ({ ...current, [line.id]: "PAY" }))}
                              />
                              {t.crewRequestPay}
                            </label>
                            <label className="flex items-center gap-2">
                              <input
                                type="radio"
                                name={`decision-${line.id}`}
                                checked={decisions[line.id] === "HOLD"}
                                onChange={() => setDecisions((current) => ({ ...current, [line.id]: "HOLD" }))}
                              />
                              {t.crewRequestHold}
                            </label>
                          </div>
                          {decisions[line.id] === "PAY" ? (
                            <div className="space-y-1">
                              <Label htmlFor={`request-amount-${line.id}`} required>{t.crewRequestAmount}</Label>
                              <Input
                                id={`request-amount-${line.id}`}
                                type="number"
                                min="0.01"
                                step="0.01"
                                value={amounts[line.id] ?? ""}
                                onChange={(event) => setAmounts((current) => ({ ...current, [line.id]: event.target.value }))}
                              />
                            </div>
                          ) : null}
                          {decisions[line.id] === "HOLD" ? (
                            <div className="space-y-1">
                              <Label htmlFor={`request-reason-${line.id}`} required>{t.crewRequestHoldReason}</Label>
                              <Textarea
                                id={`request-reason-${line.id}`}
                                rows={2}
                                minLength={5}
                                maxLength={500}
                                value={reasons[line.id] ?? ""}
                                onChange={(event) => setReasons((current) => ({ ...current, [line.id]: event.target.value }))}
                                placeholder={t.crewRequestHoldPlaceholder}
                              />
                            </div>
                          ) : null}
                        </fieldset>
                      )}
                    </li>
                  );
                })}
              </ol>
              {request.lines.some((line) => decisions[line.id] === "PAY") && (
                <div className="space-y-2 border-t border-line pt-3">
                  <div className="space-y-1">
                    <Label htmlFor={`request-earmark-${request.id}`} required>{t.crewRequestEarmark}</Label>
                    <select
                      id={`request-earmark-${request.id}`}
                      className={selectStyles}
                      value={selectedEarmarkId}
                      onChange={(event) => setEarmarkIds((current) => ({
                        ...current,
                        [request.id]: event.target.value === "" ? "" : Number(event.target.value),
                      }))}
                    >
                      <option value="">{t.crewRequestEarmarkChoose}</option>
                      {availableEarmarks.map((earmark) => (
                        <option key={earmark.id} value={earmark.id}>
                          {earmark.code ?? `#${earmark.id}`} · {earmark.purpose} · {formatPeso(earmark.amount - earmark.committed)}
                        </option>
                      ))}
                    </select>
                    {availableEarmarks.length === 0 && (
                      <p className="text-xs text-amber-800">{t.crewRequestNoEarmark}</p>
                    )}
                  </div>
                  <p className="text-sm font-medium text-ink">
                    {t.crewRequestBatchTotal.replace("{total}", formatPeso(total))}
                  </p>
                  {selectedEarmark && total > selectedEarmark.amount - selectedEarmark.committed + 0.005 && (
                    <p role="alert" className="text-sm text-danger-700">
                      {t.crewRequestOverEarmark
                        .replace("{total}", formatPeso(total))
                        .replace("{available}", formatPeso(selectedEarmark.amount - selectedEarmark.committed))}
                    </p>
                  )}
                </div>
              )}
              {request.lines.some((line) => line.status !== "VOUCHER_PREPARED" || line.voucherStatus === "REJECTED" || line.voucherStatus === "CANCELLED") && (
                <Button type="button" loading={busy === request.id} disabled={busy !== null} onClick={() => submit(request)}>
                  {busy === request.id ? t.crewRequestSaving : t.crewRequestSubmit}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
