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
import { PhotoPicker } from "@/components/ui/photo-picker";
import { apiRequest } from "@/lib/api-client";
import { copy, type Locale } from "@/lib/i18n";
import { MODES_OF_PAYMENT } from "@/lib/validations/treasury";

const selectStyles =
  "h-10 w-full rounded-control border border-line-strong bg-surface px-3 text-sm text-ink focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30";

export type VoucherActionView = {
  action: string;
  allowed: boolean;
  reason: string | null;
};

/**
 * The voucher lifecycle buttons. Which ones appear is decided on the server
 * (`voucherActionAvailability`), so a Treasurer never sees the approval button
 * and the preparer never sees their own certification — the reasons are shown
 * underneath instead of a silent dead end.
 */
export function VoucherActions({
  disbursementId,
  voucherNumber,
  actions,
  locale = "en",
}: {
  disbursementId: number;
  voucherNumber: string | null;
  actions: VoucherActionView[];
  locale?: Locale;
}) {
  const t = copy[locale].revamp.treasuryDesk;
  const common = copy[locale].revamp.common;
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // The receipt photo for a RELEASE. Kept in state so the form can preview
  // the pick and so a re-open starts clean.
  const [receipt, setReceipt] = useState<File | null>(null);

  const labels: Record<string, string> = {
    SUBMIT: t.submitVoucher,
    CERTIFY: t.certifyFunds,
    APPROVE: t.approveVoucher,
    REJECT: t.rejectVoucher,
    RELEASE: t.releaseVoucher,
    LIQUIDATE: t.liquidate,
    CANCEL: t.cancelVoucher,
  };

  const allowed = actions.filter((entry) => entry.allowed);
  const blocked = actions.filter((entry) => !entry.allowed);

  if (actions.length === 0) {
    return <p className="text-sm text-ink-subtle">{t.actionBlocked}</p>;
  }

  async function run(action: string, formData: FormData) {
    setBusy(true);
    setError(null);
    setDone(null);

    const remarks = String(formData.get("remarks") ?? "");
    const reason = String(formData.get("reason") ?? "");
    const modeOfPayment = String(formData.get("modeOfPayment") ?? "");
    const liquidationNotes = String(formData.get("liquidationNotes") ?? "");
    const liquidationStatus = String(formData.get("liquidationStatus") ?? "");

    // A release with a receipt travels as multipart — the same way every
    // other case image does — so the server validates and stores the bytes.
    const sendingReceipt = action === "RELEASE" && receipt !== null;

    const result = sendingReceipt
      ? await apiRequest<{ status: string; available: number | null }>(
          `/api/v1/treasury/disbursements/${disbursementId}`,
          {
            method: "PATCH",
            body: (() => {
              const form = new FormData();
              form.set("action", action);
              if (remarks !== "") form.set("remarks", remarks);
              if (modeOfPayment !== "") form.set("modeOfPayment", modeOfPayment);
              if (receipt) form.set("proof", receipt);
              return form;
            })(),
          }
        )
      : await apiRequest<{ status: string; available: number | null }>(
          `/api/v1/treasury/disbursements/${disbursementId}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              action,
              ...(remarks !== "" ? { remarks } : {}),
              ...(reason !== "" ? { reason } : {}),
              ...(modeOfPayment !== "" ? { modeOfPayment } : {}),
              ...(liquidationNotes !== ""
                ? { liquidationNotes }
                : {}),
              ...(liquidationStatus !== ""
                ? { liquidationStatus }
                : {}),
            }),
          }
        );

    setBusy(false);
    if (!result.success) {
      setError(result.error.message);
      return;
    }
    setReceipt(null);
    setOpen(null);
    setDone(
      action === "RELEASE"
        ? t.voucherReleased
        : action === "LIQUIDATE"
          ? t.voucherLiquidated
          : action === "REJECT"
            ? t.voucherRejected
            : result.data.status
    );
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {error && <FormMessage tone="error">{error}</FormMessage>}
      {done && <FormMessage tone="success">{done}</FormMessage>}

      {open === null && (
        <div className="flex flex-wrap gap-2">
          {allowed.map((entry) => (
            <Button
              key={entry.action}
              type="button"
              size="sm"
              variant={
                entry.action === "APPROVE" || entry.action === "CERTIFY"
                  ? "primary"
                  : "outline"
              }
              onClick={() => setOpen(entry.action)}
            >
              {labels[entry.action] ?? entry.action}
            </Button>
          ))}
        </div>
      )}

      {open !== null && (
        <form action={(formData) => run(open, formData)} className="space-y-3">
          <RequiredLegend>{t.requiredLegend}</RequiredLegend>
          <p className="text-sm font-medium text-ink-muted">
            {labels[open] ?? open}
            {voucherNumber ? ` · ${voucherNumber}` : ""}
          </p>

          {open === "REJECT" || open === "CANCEL" ? (
            <div>
              <Label htmlFor="voucher-reason" required>
                {t.cancelReason}
              </Label>
              <Textarea
                id="voucher-reason"
                name="reason"
                rows={2}
                minLength={5}
                maxLength={500}
                required
              />
            </div>
          ) : null}

          {open === "LIQUIDATE" && (
            <>
              <div>
                <Label htmlFor="voucher-liquidation-status" required>
                  {common.status}
                </Label>
                <select
                  id="voucher-liquidation-status"
                  name="liquidationStatus"
                  required
                  defaultValue="LIQUIDATED"
                  className={selectStyles}
                >
                  <option value="LIQUIDATED">LIQUIDATED</option>
                  <option value="PARTIAL">PARTIAL</option>
                </select>
              </div>
              <div>
                <Label htmlFor="voucher-liquidation-notes" required>
                  {t.particulars}
                </Label>
                <Textarea
                  id="voucher-liquidation-notes"
                  name="liquidationNotes"
                  rows={2}
                  minLength={5}
                  maxLength={500}
                  required
                />
              </div>
            </>
          )}

          {open === "RELEASE" && (
            <>
              <div>
                <Label htmlFor="voucher-mode">{t.modeOfPayment}</Label>
                <select
                  id="voucher-mode"
                  name="modeOfPayment"
                  defaultValue=""
                  className={selectStyles}
                >
                  <option value="">—</option>
                  {MODES_OF_PAYMENT.map((mode) => (
                    <option key={mode} value={mode}>
                      {mode.replace("_", " ").toLowerCase()}
                    </option>
                  ))}
                </select>
              </div>
              <PhotoPicker
                id="voucher-receipt"
                label={t.voucherReceiptPhoto}
                hint={t.voucherReceiptHint}
                onChange={(file) => setReceipt(file)}
                locale={locale}
              />
            </>
          )}

          {open !== "REJECT" && open !== "CANCEL" && (
            <div>
              <Label htmlFor="voucher-remarks">{t.remarks}</Label>
              <Textarea
                id="voucher-remarks"
                name="remarks"
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
              onClick={() => {
                setOpen(null);
                setReceipt(null);
              }}
              disabled={busy}
            >
              {common.cancel}
            </Button>
          </div>
        </form>
      )}

      {blocked.length > 0 && open === null && (
        <ul className="space-y-1 text-xs text-ink-subtle">
          {blocked.map((entry) => (
            <li key={entry.action}>
              <span className="font-medium text-ink-muted">
                {labels[entry.action] ?? entry.action}:
              </span>{" "}
              {entry.reason ?? t.actionBlocked}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
